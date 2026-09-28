import { ConflictException, ForbiddenException } from '@nestjs/common';
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
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const storage = { putObject: jest.fn(), deleteObject: jest.fn().mockResolvedValue(undefined) };
  const compliance = { evaluar: jest.fn().mockResolvedValue(new Map([[collaboratorId, { apto: true }]])) };
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
});
