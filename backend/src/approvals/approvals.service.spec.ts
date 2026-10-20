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
