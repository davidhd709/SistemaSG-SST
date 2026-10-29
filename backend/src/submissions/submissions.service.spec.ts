import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { businessDate } from '../common/business-date';

const collaboratorId = '11111111-1111-4111-8111-111111111111';
const challengeId = '22222222-2222-4222-8222-222222222222';
const leadPositionId = '33333333-3333-4333-8333-333333333333';
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
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'submission-1',
        status: 'CLOSED',
        startedAt: new Date('2026-10-21T13:00:00Z'),
        closedAt: new Date('2026-10-21T14:00:00Z'),
      }),
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
    collaborator: {
      count: jest.fn().mockResolvedValue(1),
      findUnique: jest.fn().mockResolvedValue({ site: 'ALCALA' }),
      findMany: jest.fn().mockResolvedValue([{ site: 'ALCALA' }]),
    },
    jobPosition: { findMany: jest.fn().mockResolvedValue([{ id: leadPositionId, canLead: true }]) },
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
    signAsync: jest.fn().mockResolvedValue('signed-talk-token'),
    verifyAsync: jest.fn().mockResolvedValue({
      sub: collaboratorId,
      jti: challengeId,
      purpose: 'SAFETY_TALK',
      videoId: 'charla-03',
      videoSha256: '22d9e4e6adcbd5d52aa2a22a3019e77b74fc372c28cf5fb18b9d30a6fb78057c',
      iat: Math.floor(Date.now() / 1000) - 60,
    }),
  };
  const config = { getOrThrow: jest.fn().mockReturnValue('talk-secret') };
  const templateRegistry = {
    defaultVersion: jest.fn().mockReturnValue('v00'),
    resolve: jest.fn().mockResolvedValue({ templatePath: '/template.pdf', mappingPath: '/mapping.json' }),
  };
  const pdf = { generateFinalPdf: jest.fn().mockResolvedValue('pdf-file-1') };
  const notifications = { notifyPermission: jest.fn().mockResolvedValue(undefined) };
  const service = new SubmissionsService(
    prisma as never,
    storage as never,
    compliance as never,
    pdf as never,
    templateRegistry as never,
    jwt as never,
    config as never,
    notifications as never,
  );
  return { service, prisma, tx, storage, jwt, templateRegistry, pdf, notifications };
}

describe('Secreto dedicado de charla de seguridad (AUD-022)', () => {
  it('firma y valida el reto con la clave de charla', async () => {
    const { service, jwt, prisma } = setup();
    await service.safetyTalkChallenge('charla-03', request as never);
    expect(jwt.signAsync.mock.calls[0][1]).toEqual({ secret: 'talk-secret', expiresIn: 43_200 });

    prisma.collaborator.findMany.mockResolvedValue([]);
    await expect(
      service.submit(
        'HSE-FO-016',
        {
          answers: {},
          safetyTalkConfirmed: true,
          safetyTalkToken: 'token',
          members: [{ collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: 'data:image/png;base64,AAAA' }],
        },
        request as never,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(jwt.verifyAsync.mock.calls[0][1]).toEqual({ secret: 'talk-secret' });
  });
});

describe('SubmissionsService permit safeguards', () => {
  const signature = Buffer.alloc(100);
  signature[0] = 0x89;
  signature[1] = 0x50;
  const dto = {
    answers: {},
    safetyTalkConfirmed: true,
    safetyTalkToken: 'challenge',
    members: [
      {
        collaboratorId,
        jobPositionId: leadPositionId,
        signatureDataUrl: `data:image/png;base64,${signature.toString('base64')}`,
      },
    ],
  };

  it('rejects inactive crew members before saving signatures', async () => {
    const { service, prisma, storage } = setup();
    prisma.collaborator.findMany.mockResolvedValue([]);
    await expect(service.submit('HSE-FO-016', dto, request as never)).rejects.toThrow(ForbiddenException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects a lead assigned to a catalog position that cannot lead (AUD-017)', async () => {
    const { service, prisma, storage } = setup();
    prisma.jobPosition.findMany.mockResolvedValue([{ id: leadPositionId, canLead: false }]);

    await expect(service.submit('HSE-FO-016', dto, request as never)).rejects.toThrow(BadRequestException);
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
      formVersion: {
        form: { code: 'HSE-FO-016' },
        schemaJson: { fields: [{ id: 'inicio', type: 'auto', source: 'startedAt' }] },
      },
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

  it('persiste notas y atribuye el PDF al integrante que cierra la jornada (AUD-032)', async () => {
    const { service, prisma, tx, pdf } = setup();
    prisma.formSubmission.findUnique.mockResolvedValue({
      status: 'APPROVED',
      startedAt: new Date('2026-10-21T13:00:00Z'),
      answersJson: {},
      members: [{ collaboratorId }],
      approval: { id: 'approval-1' },
      formVersion: {
        form: { code: 'HSE-FO-016' },
        schemaJson: { fields: [{ id: 'hora_fin', type: 'auto', source: 'closedAt' }] },
      },
    });

    await service.closeWorkday('submission-1', { notes: ' Sin novedades de seguridad ' }, request as never);

    const update = tx.formSubmission.updateMany.mock.calls[0][0] as {
      data: { status: string; closedById: string; closureNotes: string };
    };
    expect(update.data).toMatchObject({
      status: 'CLOSED',
      closedById: collaboratorId,
      closureNotes: 'Sin novedades de seguridad',
    });
    expect(pdf.generateFinalPdf).toHaveBeenCalledWith('submission-1', {
      kind: 'COLLABORATOR',
      id: collaboratorId,
    });
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
        data: { answersJson: Record<string, unknown>; templateVersion: string };
      };
      expect(createdArgs.data.templateVersion).toBe('v00');
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

describe('Corrección de un permiso rechazado', () => {
  const rejectedId = '44444444-4444-4444-8444-444444444444';
  const signature = Buffer.alloc(100);
  signature[0] = 0x89;
  signature[1] = 0x50;
  const dto = {
    answers: {},
    safetyTalkConfirmed: true,
    safetyTalkToken: 'challenge',
    previousSubmissionId: rejectedId,
    members: [
      {
        collaboratorId,
        jobPositionId: leadPositionId,
        signatureDataUrl: `data:image/png;base64,${signature.toString('base64')}`,
      },
    ],
  };
  const rechazado = (overrides: Record<string, unknown> = {}) => ({
    id: rejectedId,
    collaboratorId,
    status: 'REJECTED',
    workDate: new Date('2026-10-21T00:00:00Z'),
    answersJson: { lugar: 'Subestación norte', fecha_auto: '21/10/2026', inventado: 'x' },
    approval: { reason: 'Falta describir el punto de anclaje.' },
    correction: null,
    formVersion: {
      form: { code: 'HSE-FO-016' },
      schemaJson: {
        fields: [
          { id: 'lugar', type: 'text' },
          { id: 'fecha_auto', type: 'auto', source: 'workDate' },
        ],
      },
    },
    members: [{ collaboratorId, jobPositionId: leadPositionId, isLead: true }],
    ...overrides,
  });

  it('entrega motivo, cuadrilla y solo las respuestas editables del formato', async () => {
    const { service, prisma } = setup();
    prisma.formSubmission.findUnique.mockResolvedValue(rechazado());
    const fuente = await service.correctionSource(rejectedId, request as never);
    expect(fuente.reason).toBe('Falta describir el punto de anclaje.');
    expect(fuente.answers).toEqual({ lugar: 'Subestación norte' });
    expect(fuente.members).toEqual([{ collaboratorId, jobPositionId: leadPositionId, isLead: true }]);
  });

  it('solo la corrige el oficial que la diligenció, si está rechazada y una sola vez', async () => {
    const { service, prisma } = setup();
    prisma.formSubmission.findUnique.mockResolvedValueOnce(
      rechazado({ collaboratorId: '55555555-5555-4555-8555-555555555555' }),
    );
    await expect(service.correctionSource(rejectedId, request as never)).rejects.toThrow(ForbiddenException);
    prisma.formSubmission.findUnique.mockResolvedValueOnce(rechazado({ status: 'CLOSED' }));
    await expect(service.correctionSource(rejectedId, request as never)).rejects.toThrow(ConflictException);
    prisma.formSubmission.findUnique.mockResolvedValueOnce(rechazado({ correction: { id: 'otro' } }));
    await expect(service.correctionSource(rejectedId, request as never)).rejects.toThrow(ConflictException);
  });

  it('enlaza el reenvío con el permiso rechazado', async () => {
    const { service, prisma, tx, storage } = setup();
    prisma.formSubmission.findUnique.mockResolvedValue(rechazado());
    storage.putObject.mockResolvedValue({
      storageProvider: 'LOCAL',
      bucket: 'local',
      objectKey: 'signatures/a.png',
      sizeBytes: 100,
      sha256: 'abc',
    });
    await service.submit('HSE-FO-016', dto, request as never);
    expect(tx.formSubmission.create.mock.calls[0][0].data.previousSubmissionId).toBe(rejectedId);
    expect(tx.auditEvent.create.mock.calls[0][0].data.afterJson.previousSubmissionId).toBe(rejectedId);
  });

  it('rechaza un segundo reenvío concurrente del mismo permiso y limpia las firmas', async () => {
    const { service, prisma, tx, storage } = setup();
    prisma.formSubmission.findUnique.mockResolvedValue(rechazado());
    storage.putObject.mockResolvedValue({
      storageProvider: 'LOCAL',
      bucket: 'local',
      objectKey: 'signatures/b.png',
      sizeBytes: 100,
      sha256: 'abc',
    });
    tx.formSubmission.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(service.submit('HSE-FO-016', dto, request as never)).rejects.toThrow(
      'Este permiso rechazado ya fue corregido.',
    );
    expect(storage.deleteObject).toHaveBeenCalledWith('signatures/b.png');
  });

  it('marca como corregible el último permiso rechazado del oficial', async () => {
    const { service, prisma } = setup();
    prisma.formSubmission.findFirst.mockResolvedValue({
      id: rejectedId,
      status: 'REJECTED',
      collaboratorId,
      correction: null,
      members: [],
    });
    expect(await service.latest(request as never)).toMatchObject({ id: rejectedId, correctable: true });
  });
});

describe('Formatos oficiales sueltos (ATS, eléctrico, escalera)', () => {
  const firma = Buffer.alloc(120);
  firma[0] = 0x89;
  firma[1] = 0x50;
  const firmaDataUrl = `data:image/png;base64,${firma.toString('base64')}`;
  const otroId = '44444444-4444-4444-8444-444444444444';
  const esquemaAts = {
    fields: [
      { id: 'obra', type: 'text', required: true },
      { id: 'entrega_operacion_segura', type: 'yes_no', required: true, stage: 'close' },
      {
        id: 'entrega_medidas',
        type: 'textarea',
        required: false,
        stage: 'close',
        requiredWhen: { field: 'entrega_operacion_segura', equals: 'NO' },
      },
    ],
  };

  function conFormato(code: string, schemaJson: unknown) {
    const ctx = setup();
    ctx.prisma.form.findUnique.mockResolvedValue({
      code,
      name: code,
      status: 'PUBLISHED',
      currentVersion: { id: 'version', active: true, versionNumber: 1, schemaJson },
    });
    ctx.storage.putObject.mockImplementation(({ objectKey }: { objectKey: string }) =>
      Promise.resolve({ objectKey, storageProvider: 'local', bucket: 'b', sizeBytes: 120, sha256: 'x' }),
    );
    return ctx;
  }

  it('envía un ATS sin charla de seguridad y solo choca con otro ATS abierto', async () => {
    const { service, prisma, tx, jwt } = conFormato('HSE-FO-018', esquemaAts);
    await service.submit(
      'HSE-FO-018',
      {
        answers: { obra: 'Subestación norte' },
        members: [{ collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl }],
      },
      request as never,
    );
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    const abierta = prisma.formSubmission.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(abierta.where.formVersion).toEqual({ form: { code: 'HSE-FO-018' } });
    const creado = tx.formSubmission.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(creado.data).toMatchObject({ safetyTalkConfirmed: false });
    expect(creado.data.safetyTalkChallengeId).toBeUndefined();
  });

  it('no acepta al enviar los campos que el formato pide al terminar la tarea', async () => {
    const { service } = conFormato('HSE-FO-018', esquemaAts);
    await expect(
      service.submit(
        'HSE-FO-018',
        {
          answers: { obra: 'Subestación norte', entrega_operacion_segura: 'SI' },
          members: [{ collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl }],
        },
        request as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('la inspección de escalera admite solo a quien inspecciona', async () => {
    const { service } = conFormato('HSE-FO-023', { fields: [] });
    await expect(
      service.submit(
        'HSE-FO-023',
        {
          answers: {},
          members: [
            { collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl },
            { collaboratorId: otroId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl },
          ],
        },
        request as never,
      ),
    ).rejects.toThrow('admite hasta 1 persona');
  });

  function jornadaAbierta(code: string, schemaJson: unknown, members = [{ id: 'm-1', collaboratorId }]) {
    const ctx = conFormato(code, schemaJson);
    ctx.prisma.formSubmission.findUnique.mockResolvedValue({
      status: 'APPROVED',
      startedAt: new Date('2026-10-21T13:00:00Z'),
      answersJson: { obra: 'Subestación norte' },
      members,
      approval: { id: 'approval-1' },
      formVersion: { form: { code }, schemaJson },
    });
    (ctx.tx as unknown as { submissionMember: { update: jest.Mock } }).submissionMember.update = jest
      .fn()
      .mockResolvedValue({});
    return ctx;
  }

  it('exige la entrega de la tarea del ATS al cerrar y la guarda con las respuestas', async () => {
    const { service, tx } = jornadaAbierta('HSE-FO-018', esquemaAts);
    await expect(
      service.closeWorkday('submission-1', { answers: { entrega_operacion_segura: 'NO' } }, request as never),
    ).rejects.toThrow('entrega_medidas es obligatorio');

    await service.closeWorkday(
      'submission-1',
      { answers: { entrega_operacion_segura: 'NO', entrega_medidas: 'Retirar escombros' } },
      request as never,
    );
    const update = tx.formSubmission.updateMany.mock.calls[0][0] as { data: { answersJson: Record<string, unknown> } };
    expect(update.data.answersJson).toMatchObject({
      obra: 'Subestación norte',
      entrega_operacion_segura: 'NO',
      entrega_medidas: 'Retirar escombros',
    });
  });

  it('el permiso eléctrico no se cierra sin la firma de término de cada integrante', async () => {
    const members = [
      { id: 'm-1', collaboratorId },
      { id: 'm-2', collaboratorId: otroId },
    ];
    const { service, tx, storage } = jornadaAbierta('FORSG-03', { fields: [] }, members);
    await expect(
      service.closeWorkday(
        'submission-1',
        { signatures: [{ collaboratorId, signatureDataUrl: firmaDataUrl }] },
        request as never,
      ),
    ).rejects.toThrow('firmar el término');
    expect(storage.putObject).not.toHaveBeenCalled();

    await service.closeWorkday(
      'submission-1',
      {
        signatures: [
          { collaboratorId, signatureDataUrl: firmaDataUrl },
          { collaboratorId: otroId, signatureDataUrl: firmaDataUrl },
        ],
      },
      request as never,
    );
    const actualizar = (tx as unknown as { submissionMember: { update: jest.Mock } }).submissionMember.update;
    expect(actualizar).toHaveBeenCalledTimes(2);
    expect(actualizar).toHaveBeenCalledWith({ where: { id: 'm-2' }, data: { closingSignatureId: 'sig-1' } });
  });
});

describe('Sedes: charla en video en Alcalá y presencial en Montelíbano', () => {
  const firma = Buffer.alloc(120);
  firma[0] = 0x89;
  firma[1] = 0x50;
  const firmaDataUrl = `data:image/png;base64,${firma.toString('base64')}`;
  const ayudanteId = '55555555-5555-4555-8555-555555555555';

  function enMontelibano() {
    const ctx = setup();
    ctx.prisma.collaborator.findUnique.mockResolvedValue({ site: 'MONTELIBANO' });
    ctx.prisma.collaborator.findMany.mockResolvedValue([{ site: 'MONTELIBANO' }]);
    ctx.storage.putObject.mockImplementation(({ objectKey }: { objectKey: string }) =>
      Promise.resolve({ objectKey, storageProvider: 'local', bucket: 'b', sizeBytes: 120, sha256: 'x' }),
    );
    return ctx;
  }

  it('en Montelíbano acepta la charla presencial declarada sin video', async () => {
    const { service, tx, jwt } = enMontelibano();
    await service.submit(
      'HSE-FO-016',
      {
        answers: {},
        safetyTalkConfirmed: true,
        members: [{ collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl }],
      },
      request as never,
    );
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    const creado = tx.formSubmission.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(creado.data).toMatchObject({ site: 'MONTELIBANO', safetyTalkConfirmed: true });
    expect(creado.data.safetyTalkVideo).toBeUndefined();
    expect(tx.auditEvent.create.mock.calls[0][0].data.afterJson).toMatchObject({ safetyTalkMode: 'PRESENCIAL' });
  });

  it('en Montelíbano sigue exigiendo la declaración de la charla', async () => {
    const { service, tx } = enMontelibano();
    await expect(
      service.submit(
        'HSE-FO-016',
        { answers: {}, members: [{ collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl }] },
        request as never,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.formSubmission.create).not.toHaveBeenCalled();
  });

  it('en Alcalá no basta la declaración: exige haber visto el video', async () => {
    const { service, storage } = setup();
    await expect(
      service.submit(
        'HSE-FO-016',
        {
          answers: {},
          safetyTalkConfirmed: true,
          members: [{ collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl }],
        },
        request as never,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('no deja mezclar en la cuadrilla personas de otra sede', async () => {
    const { service, prisma, storage } = enMontelibano();
    prisma.collaborator.findMany.mockResolvedValue([{ site: 'MONTELIBANO' }, { site: 'ALCALA' }]);
    await expect(
      service.submit(
        'HSE-FO-016',
        {
          answers: {},
          safetyTalkConfirmed: true,
          members: [
            { collaboratorId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl },
            { collaboratorId: ayudanteId, jobPositionId: leadPositionId, signatureDataUrl: firmaDataUrl },
          ],
        },
        request as never,
      ),
    ).rejects.toThrow('Toda la cuadrilla debe pertenecer a la sede Montelíbano.');
    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
