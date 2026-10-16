import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { businessDate } from '../common/business-date';

const collaboratorId = '11111111-1111-4111-8111-111111111111';
const challengeId = '22222222-2222-4222-8222-222222222222';
const request = {
  principal: { kind: 'COLLABORATOR', collaboratorId },
  ip: '127.0.0.1',
  header: () => undefined,
  correlationId: 'test',
};

function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    formSubmission: {
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'submission-1', status: 'PENDING_APPROVAL', submittedAt: new Date() }),
    },
    submissionMember: {
      create: jest.fn().mockResolvedValue({ id: 'member-1' }),
    },
    fileObject: {
      create: jest.fn().mockResolvedValue({ id: 'file-1' }),
    },
    signature: {
      create: jest.fn().mockResolvedValue({ id: 'sig-1' }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    formSubmission: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    form: {
      findUnique: jest.fn().mockResolvedValue({
        code: 'HSE-FO-016',
        status: 'PUBLISHED',
        currentVersion: { id: 'version', active: true, versionNumber: 1, schemaJson: { fields: [] } },
      }),
    },
    collaborator: { count: jest.fn().mockResolvedValue(1) },
    jobPosition: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const storage = { putObject: jest.fn(), deleteObject: jest.fn().mockResolvedValue(undefined) };
  const compliance = {
    evaluar: jest.fn().mockResolvedValue(
      new Map([
        [
          collaboratorId,
          {
            apto: true,
            alturas: { estado: 'VIGENTE' },
            seguridadSocial: { estado: 'VIGENTE' },
          },
        ],
      ]),
    ),
  };
  const jwt = {
    verifyAsync: jest.fn().mockResolvedValue({
      sub: collaboratorId,
      jti: challengeId,
      purpose: 'SAFETY_TALK',
      videoId: 'charla-03',
      videoSha256: '22d9e4e6adcbd5d52aa2a22a3019e77b74fc372c28cf5fb18b9d30a6fb78057c',
      iat: Math.floor(Date.now() / 1000) - 60,
    }),
  };
  const config = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
  const service = new SubmissionsService(
    prisma as never,
    storage as never,
    compliance as never,
    {} as never,
    jwt as never,
    config as never,
  );
  return { service, prisma, tx, storage, jwt };
}

describe('SubmissionsService permit safeguards', () => {
  const signature = Buffer.alloc(100);
  signature[0] = 0x89;
  signature[1] = 0x50;
  const dto = {
    answers: {},
    safetyTalkConfirmed: true,
    safetyTalkToken: 'challenge',
    members: [{ collaboratorId, signatureDataUrl: `data:image/png;base64,${signature.toString('base64')}` }],
  };

  it('rejects inactive crew members before saving signatures', async () => {
    const { service, prisma, storage } = setup();
    prisma.collaborator.count.mockResolvedValue(0);
    await expect(service.submit('HSE-FO-016', dto, request as never)).rejects.toThrow(ForbiddenException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects a crew member with a pending permit inside the transaction', async () => {
    const { service, tx, storage } = setup();
    storage.putObject.mockResolvedValue({
      objectKey: 'signatures/test.png',
      storageProvider: 'LOCAL',
      bucket: 'local',
      sizeBytes: 100,
      sha256: 'test',
    });
    tx.formSubmission.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(service.submit('HSE-FO-016', dto, request as never)).rejects.toThrow(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith('signatures/test.png');
  });

  it('requires the minimum talk time before accepting the declaration', async () => {
    const { service, jwt } = setup();
    jwt.verifyAsync.mockResolvedValue({
      sub: collaboratorId,
      jti: challengeId,
      purpose: 'SAFETY_TALK',
      videoId: 'charla-03',
      videoSha256: '22d9e4e6adcbd5d52aa2a22a3019e77b74fc372c28cf5fb18b9d30a6fb78057c',
      iat: Math.floor(Date.now() / 1000),
    });
    await expect(service.submit('HSE-FO-016', dto, request as never)).rejects.toThrow(ForbiddenException);
  });

  it('records start only after approval and only once', async () => {
    const { service, prisma, tx } = setup();
    const current = {
      status: 'APPROVED',
      startedAt: null,
      workDate: businessDate(new Date()),
      answersJson: {},
      members: [{ collaboratorId }],
      formVersion: { schemaJson: { fields: [{ id: 'inicio', type: 'auto', source: 'startedAt' }] } },
    };
    prisma.formSubmission.findUnique.mockResolvedValue(current);
    const result = await service.startWorkday('permit', request as never);
    expect(result.startedAt).toBeInstanceOf(Date);
    expect(tx.formSubmission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'permit', status: 'APPROVED', startedAt: null } }),
    );
    prisma.formSubmission.findUnique.mockResolvedValue({ ...current, startedAt: new Date() });
    await expect(service.startWorkday('permit', request as never)).rejects.toThrow(ConflictException);
  });

  it('expires an unused permit and records why the crew was released', async () => {
    const { service, prisma, tx } = setup();
    prisma.formSubmission.findMany.mockResolvedValue([{ id: 'old-permit', status: 'APPROVED' }]);
    await service.expireStalePermits();
    const update = tx.formSubmission.updateMany.mock.calls[0][0] as {
      where: { id: string; startedAt: Date | null };
      data: { status: string };
    };
    const audit = tx.auditEvent.create.mock.calls[0][0] as { data: { action: string } };
    expect(update.where.id).toBe('old-permit');
    expect(update.where.startedAt).toBeNull();
    expect(update.data.status).toBe('EXPIRED');
    expect(audit.data.action).toBe('EXPIRE_UNUSED_PERMIT');
  });

  describe('AUD-001: protection of answers and reserved fields', () => {
    const testSchema = {
      fields: [
        { id: 'empresa', type: 'select', required: true, options: ['OPAINN ESP SAS', 'ESO INGENIERIA'] },
        { id: 'lugar_trabajo', type: 'text', required: true },
        { id: 'otras_tar_involucradas', type: 'yes_no', required: true },
        { id: 'otras_tar', type: 'multi_select', required: true, options: ['Trabajo en caliente', 'Otras'] },
        { id: 'otras_tar_detalle', type: 'text', required: false },
        { id: 'fecha_trabajo', type: 'auto', required: true, source: 'workDate' },
        { id: 'hora_inicio', type: 'auto', required: true, source: 'startedAt' },
        { id: 'hora_finalizacion', type: 'auto', required: true, source: 'closedAt' },
        { id: 'certificado_alturas', type: 'auto', required: true, source: 'heightCertificate' },
        { id: 'seguridad_social_verificada', type: 'auto', required: true, source: 'socialSecurity' },
      ],
    };

    const validAnswers = {
      empresa: 'OPAINN ESP SAS',
      lugar_trabajo: 'Poste 14',
      otras_tar_involucradas: 'NO',
      otras_tar: [],
      otras_tar_detalle: '',
    };

    it('rejects answers with manipulated crew cedula without storing data', async () => {
      const { service, prisma, storage, tx } = setup();
      prisma.form.findUnique.mockResolvedValue({
        code: 'HSE-FO-016',
        status: 'PUBLISHED',
        currentVersion: { id: 'version', active: true, versionNumber: 1, schemaJson: testSchema },
      });

      await expect(
        service.submit(
          'HSE-FO-016',
          {
            ...dto,
            answers: { ...validAnswers, cuadrilla_01_cedula: '999999999' },
          },
          request as never,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submit(
          'HSE-FO-016',
          {
            ...dto,
            answers: { ...validAnswers, ejecutor_01_cedula: '999999999' },
          },
          request as never,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(storage.putObject).not.toHaveBeenCalled();
      expect(tx.formSubmission.create).not.toHaveBeenCalled();
    });

    it('rejects answers with protected crew name or job role', async () => {
      const { service, prisma, storage, tx } = setup();
      prisma.form.findUnique.mockResolvedValue({
        code: 'HSE-FO-016',
        status: 'PUBLISHED',
        currentVersion: { id: 'version', active: true, versionNumber: 1, schemaJson: testSchema },
      });

      await expect(
        service.submit(
          'HSE-FO-016',
          {
            ...dto,
            answers: { ...validAnswers, cuadrilla_01_nombre: 'Nombre Suplantado' },
          },
          request as never,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submit(
          'HSE-FO-016',
          {
            ...dto,
            answers: { ...validAnswers, cuadrilla_01_cargo: 'Coordinador Falso' },
          },
          request as never,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(storage.putObject).not.toHaveBeenCalled();
      expect(tx.formSubmission.create).not.toHaveBeenCalled();
    });

    it('rejects additional undefined fields, automatic server fields, and signature fields', async () => {
      const { service, prisma, storage, tx } = setup();
      prisma.form.findUnique.mockResolvedValue({
        code: 'HSE-FO-016',
        status: 'PUBLISHED',
        currentVersion: { id: 'version', active: true, versionNumber: 1, schemaJson: testSchema },
      });

      const forbiddenPayloads = [
        { ...validAnswers, campo_extra_no_definido: 'valor' },
        { ...validAnswers, fecha_trabajo: '2099-12-31' },
        { ...validAnswers, hora_inicio: '00:00' },
        { ...validAnswers, certificado_alturas: 'Falsificado' },
        { ...validAnswers, autorizador_firma: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
        { ...validAnswers, coordinador_alturas_firma: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' },
      ];

      for (const badAnswers of forbiddenPayloads) {
        await expect(service.submit('HSE-FO-016', { ...dto, answers: badAnswers }, request as never)).rejects.toThrow(
          BadRequestException,
        );
      }

      expect(storage.putObject).not.toHaveBeenCalled();
      expect(tx.formSubmission.create).not.toHaveBeenCalled();
    });

    it('preserves current behavior for legitimate submissions and populates automatic fields on the server', async () => {
      const { service, prisma, storage, tx } = setup();
      prisma.form.findUnique.mockResolvedValue({
        code: 'HSE-FO-016',
        status: 'PUBLISHED',
        currentVersion: { id: 'version', active: true, versionNumber: 1, schemaJson: testSchema },
      });
      storage.putObject.mockResolvedValue({
        objectKey: 'signatures/legit.png',
        storageProvider: 'LOCAL',
        bucket: 'local',
        sizeBytes: 100,
        sha256: 'legit-sha',
      });

      const response = await service.submit(
        'HSE-FO-016',
        {
          ...dto,
          answers: validAnswers,
        },
        request as never,
      );

      expect(response.id).toBe('submission-1');
      expect(tx.formSubmission.create).toHaveBeenCalledTimes(1);
      const createdArgs = tx.formSubmission.create.mock.calls[0][0] as {
        data: { answersJson: Record<string, unknown> };
      };
      expect(createdArgs.data.answersJson).toMatchObject({
        empresa: 'OPAINN ESP SAS',
        lugar_trabajo: 'Poste 14',
        otras_tar_involucradas: 'NO',
        otras_tar: [],
        otras_tar_detalle: '',
        hora_inicio: 'Pendiente de inicio',
        hora_finalizacion: 'Jornada en curso',
        certificado_alturas: 'Vigente y verificado',
        seguridad_social_verificada: 'Vigente y verificado',
      });
      expect(createdArgs.data.answersJson.fecha_trabajo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects incomplete or invalid schemas when validating answers', async () => {
      const { service, prisma, storage, tx } = setup();
      const invalidSchemas = [
        null,
        { fields: 'no-es-arreglo' },
        { fields: [{ id: '', type: 'text' }] },
        { fields: [{ id: 'campo_raro', type: 'tipo_inexistente' }] },
        { fields: [{ id: 'cuadrilla_01_cedula', type: 'text' }] },
        { fields: [{ id: 'autorizador_firma', type: 'text' }] },
      ];

      for (const badSchema of invalidSchemas) {
        prisma.form.findUnique.mockResolvedValue({
          code: 'HSE-FO-016',
          status: 'PUBLISHED',
          currentVersion: { id: 'version', active: true, versionNumber: 1, schemaJson: badSchema },
        });
        await expect(service.submit('HSE-FO-016', { ...dto, answers: {} }, request as never)).rejects.toThrow(
          BadRequestException,
        );
      }

      expect(storage.putObject).not.toHaveBeenCalled();
      expect(tx.formSubmission.create).not.toHaveBeenCalled();
    });

    it('validates editable text and textarea fields for type, length, and allows legitimate names like confirmacion', async () => {
      const { service, prisma, storage, tx } = setup();
      const schemaWithTextAndConfirmation = {
        fields: [
          ...testSchema.fields,
          { id: 'observaciones', type: 'textarea', required: false },
          { id: 'confirmacion_lectura', type: 'yes_no', required: true },
        ],
      };
      prisma.form.findUnique.mockResolvedValue({
        code: 'HSE-FO-016',
        status: 'PUBLISHED',
        currentVersion: {
          id: 'version',
          active: true,
          versionNumber: 1,
          schemaJson: schemaWithTextAndConfirmation,
        },
      });

      const baseValid = {
        ...validAnswers,
        confirmacion_lectura: 'SI',
      };

      // Rechaza tipo no string en campo text
      await expect(
        service.submit('HSE-FO-016', { ...dto, answers: { ...baseValid, lugar_trabajo: 12345 } }, request as never),
      ).rejects.toThrow(BadRequestException);

      // Rechaza campo obligatorio con solo espacios en blanco
      await expect(
        service.submit('HSE-FO-016', { ...dto, answers: { ...baseValid, lugar_trabajo: '   ' } }, request as never),
      ).rejects.toThrow(BadRequestException);

      // Rechaza exceso de longitud en text (> 500) y textarea (> 2000)
      await expect(
        service.submit(
          'HSE-FO-016',
          { ...dto, answers: { ...baseValid, lugar_trabajo: 'A'.repeat(501) } },
          request as never,
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submit(
          'HSE-FO-016',
          { ...dto, answers: { ...baseValid, observaciones: 'B'.repeat(2001) } },
          request as never,
        ),
      ).rejects.toThrow(BadRequestException);

      // Rechaza data:image/ infiltrado en un campo de texto editable
      await expect(
        service.submit(
          'HSE-FO-016',
          { ...dto, answers: { ...baseValid, lugar_trabajo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' } },
          request as never,
        ),
      ).rejects.toThrow(BadRequestException);

      // Permite envío legítimo con textarea válido y campo "confirmacion_lectura" (que contiene la subcadena "firma")
      storage.putObject.mockResolvedValue({
        objectKey: 'signatures/legit-2.png',
        storageProvider: 'LOCAL',
        bucket: 'local',
        sizeBytes: 100,
        sha256: 'legit-sha-2',
      });

      const ok = await service.submit(
        'HSE-FO-016',
        {
          ...dto,
          answers: {
            ...baseValid,
            observaciones: 'Observación legítima dentro del límite permitido.',
          },
        },
        request as never,
      );
      expect(ok.id).toBe('submission-1');
      expect(tx.formSubmission.create).toHaveBeenCalledTimes(1);
    });
  });
});
