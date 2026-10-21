import { AuditService } from './audit.service';

describe('AuditService (AUD-010)', () => {
  it('persiste siempre el evento de auditoría sin depender de banderas opcionales', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const service = new AuditService({ auditEvent: { create } } as never);

    const input = {
      actorUserId: 'user-1',
      action: 'LOGIN_FAILED',
      entityType: 'USER',
      entityId: 'user-1',
      ip: '127.0.0.1',
      userAgent: 'jest',
      correlationId: 'corr-1',
    };

    await service.record(input);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ data: input });
  });
});
