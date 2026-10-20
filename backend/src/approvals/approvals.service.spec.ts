import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';

describe('ApprovalsService.generateMissingPdf (AUD-005)', () => {
  const userRequest = { principal: { kind: 'USER', userId: 'coord-1' } };

  function context(submission: unknown) {
    const prisma = { formSubmission: { findUnique: jest.fn().mockResolvedValue(submission) } };
    const pdf = { generateFinalPdf: jest.fn().mockResolvedValue('pdf-file-1') };
    const service = new ApprovalsService(prisma as never, {} as never, pdf as never, {} as never);
    return { service, prisma, pdf };
  }

  it('genera el documento faltante de una jornada cerrada con el usuario solicitante', async () => {
    const { service, prisma, pdf } = context({
      status: 'CLOSED',
      approval: { id: 'approval-1' },
      finalPdfFileId: null,
    });

    await expect(service.generateMissingPdf('submission-1', userRequest as never)).resolves.toEqual({
      submissionId: 'submission-1',
      pdfFileId: 'pdf-file-1',
    });
    expect(prisma.formSubmission.findUnique).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      select: { status: true, approval: { select: { id: true } }, finalPdfFileId: true },
    });
    expect(pdf.generateFinalPdf).toHaveBeenCalledWith('submission-1', 'coord-1');
  });

  it('permite recuperar el PDF de un envío rechazado', async () => {
    const { service, pdf } = context({ status: 'REJECTED', approval: { id: 'approval-1' }, finalPdfFileId: null });
    await service.generateMissingPdf('submission-1', userRequest as never);
    expect(pdf.generateFinalPdf).toHaveBeenCalledTimes(1);
  });

  it('rechaza un actor sin usuario administrativo', async () => {
    const { service, prisma } = context(null);
    await expect(
      service.generateMissingPdf('submission-1', { principal: { kind: 'COLLABORATOR' } } as never),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.formSubmission.findUnique).not.toHaveBeenCalled();
  });

  it('distingue envíos inexistentes, abiertos y ya documentados', async () => {
    const missing = context(null);
    await expect(missing.service.generateMissingPdf('submission-1', userRequest as never)).rejects.toThrow(
      NotFoundException,
    );

    const open = context({ status: 'APPROVED', approval: { id: 'approval-1' }, finalPdfFileId: null });
    await expect(open.service.generateMissingPdf('submission-1', userRequest as never)).rejects.toThrow(
      ConflictException,
    );
    expect(open.pdf.generateFinalPdf).not.toHaveBeenCalled();

    const existing = context({ status: 'CLOSED', approval: { id: 'approval-1' }, finalPdfFileId: 'pdf-old' });
    await expect(existing.service.generateMissingPdf('submission-1', userRequest as never)).rejects.toThrow(
      ConflictException,
    );
    expect(existing.pdf.generateFinalPdf).not.toHaveBeenCalled();
  });

  it('propaga fallos de generación para poder reintentar sin marcar el PDF como generado', async () => {
    const { service, pdf } = context({ status: 'CLOSED', approval: { id: 'approval-1' }, finalPdfFileId: null });
    pdf.generateFinalPdf.mockRejectedValueOnce(new Error('firma ilegible'));
    await expect(service.generateMissingPdf('submission-1', userRequest as never)).rejects.toThrow('firma ilegible');
  });
});

describe('ApprovalsService.adminCloseWorkday (AUD-025)', () => {
  const request = {
    principal: { kind: 'USER', userId: 'coord-1', permissions: ['submissions:close-admin'] },
    ip: '127.0.0.1',
    header: () => 'test-agent',
    correlationId: 'request-1',
  };

  function context(submission: unknown, changedCount = 1) {
    const tx = {
      formSubmission: {
        findUnique: jest.fn().mockResolvedValue(submission),
        updateMany: jest.fn().mockResolvedValue({ count: changedCount }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) };
    const pdf = { generateFinalPdf: jest.fn().mockResolvedValue('pdf-file-1') };
    const service = new ApprovalsService(prisma as never, {} as never, pdf as never, {} as never);
    return { service, tx, pdf };
  }

  const started = { status: 'APPROVED', startedAt: new Date('2026-10-20T14:00:00Z'), approval: { id: 'approval-1' } };

  it('cierra una jornada iniciada, registra actor y motivo, y genera el PDF', async () => {
    const { service, tx, pdf } = context(started);
    const result = await service.adminCloseWorkday(
      'submission-1',
      { reason: ' Oficial sin acceso ' },
      request as never,
    );

    expect(result.closedAt).toBeInstanceOf(Date);
    expect(result).toEqual({
      id: 'submission-1',
      status: 'CLOSED',
      closedAt: result.closedAt,
      pdfFileId: 'pdf-file-1',
    });
    expect(tx.formSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: 'submission-1', status: 'APPROVED', startedAt: { not: null } },
      data: { status: 'CLOSED', closedAt: result.closedAt },
    });
    const audit = tx.auditEvent.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(audit.data).toMatchObject({
      actorUserId: 'coord-1',
      action: 'ADMIN_CLOSE_WORKDAY',
      entityId: 'submission-1',
      reason: 'Oficial sin acceso',
      correlationId: 'request-1',
    });
    expect(pdf.generateFinalPdf).toHaveBeenCalledWith('submission-1', 'coord-1');
  });

  it('rechaza actor sin permiso y motivo vacío', async () => {
    const { service, tx } = context(started);
    await expect(
      service.adminCloseWorkday('submission-1', { reason: 'motivo' }, {
        ...request,
        principal: { kind: 'USER', userId: 'other', permissions: [] },
      } as never),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.adminCloseWorkday('submission-1', { reason: '   ' }, request as never)).rejects.toThrow(
      ConflictException,
    );
    expect(tx.formSubmission.updateMany).not.toHaveBeenCalled();
  });

  it('rechaza permisos inexistentes, no iniciados y cierres concurrentes', async () => {
    await expect(
      context(null).service.adminCloseWorkday('submission-1', { reason: 'motivo' }, request as never),
    ).rejects.toThrow(NotFoundException);
    await expect(
      context({ ...started, startedAt: null }).service.adminCloseWorkday(
        'submission-1',
        { reason: 'motivo' },
        request as never,
      ),
    ).rejects.toThrow(ConflictException);
    const concurrent = context(started, 0);
    await expect(
      concurrent.service.adminCloseWorkday('submission-1', { reason: 'motivo' }, request as never),
    ).rejects.toThrow(ConflictException);
    expect(concurrent.tx.auditEvent.create).not.toHaveBeenCalled();
  });

  it('conserva el cierre aunque falle el PDF, para recuperarlo después', async () => {
    const { service, tx, pdf } = context(started);
    pdf.generateFinalPdf.mockRejectedValueOnce(new Error('storage unavailable'));
    const result = await service.adminCloseWorkday('submission-1', { reason: 'motivo' }, request as never);
    expect(result.pdfFileId).toBeNull();
    expect(tx.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});
