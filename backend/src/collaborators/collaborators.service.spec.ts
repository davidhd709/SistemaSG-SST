import { CollaboratorsService } from './collaborators.service';

describe('CollaboratorsService.update sessions (AUD-019)', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const request = {
    principal: { kind: 'USER', userId: 'admin-1' },
    ip: '127.0.0.1',
    header: () => undefined,
    correlationId: 'test',
  };

  function setup() {
    const previous = {
      id,
      documentNumber: '12345678',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: null,
      phone: null,
      jobTitle: 'Oficial eléctrico',
      jobPositionId: 'position-lead',
      jobPosition: { id: 'position-lead', name: 'Oficial eléctrico', code: 'OFICIAL', canLead: true, active: true },
      team: null,
      status: 'ACTIVE',
      pinHash: 'previous-hash',
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    const tx = {
      collaborator: { update: jest.fn().mockResolvedValue(previous) },
      refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      collaborator: { findUniqueOrThrow: jest.fn().mockResolvedValue(previous) },
      jobPosition: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'position-helper',
          name: 'Auxiliar',
          code: 'AUXILIAR',
          canLead: false,
          active: true,
        }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new CollaboratorsService(prisma as never), tx };
  }

  it('revokes refresh sessions and audits a PIN change without recording the PIN', async () => {
    const { service, tx } = setup();
    await service.update(id, { pin: '9876' }, request as never);

    const revocation = tx.refreshSession.updateMany.mock.calls[0][0] as {
      where: { collaboratorId: string; revokedAt: null; expiresAt: { gt: Date } };
      data: { revokedAt: Date };
    };
    expect(revocation.where.collaboratorId).toBe(id);
    expect(revocation.where.revokedAt).toBeNull();
    expect(revocation.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(revocation.data.revokedAt).toBeInstanceOf(Date);
    const audit = tx.auditEvent.create.mock.calls[0][0] as {
      data: { afterJson: { pinChanged: boolean; sessionsRevoked: boolean } };
    };
    expect(audit.data.afterJson.pinChanged).toBe(true);
    expect(audit.data.afterJson.sessionsRevoked).toBe(true);
    expect(JSON.stringify(tx.auditEvent.create.mock.calls)).not.toContain('9876');
  });

  it('revokes sessions when the collaborator is inactivated or the PIN is removed', async () => {
    const inactive = setup();
    await inactive.service.update(id, { status: 'INACTIVE' }, request as never);
    expect(inactive.tx.refreshSession.updateMany).toHaveBeenCalledTimes(1);

    const changedRole = setup();
    await changedRole.service.update(id, { jobTitle: 'Auxiliar' }, request as never);
    expect(changedRole.tx.refreshSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps sessions for ordinary profile edits', async () => {
    const { service, tx } = setup();
    await service.update(id, { team: 'Norte' }, request as never);
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects assigning a PIN to a job position without leadership permission (AUD-029)', async () => {
    const { service, tx } = setup();
    await expect(service.update(id, { jobTitle: 'Auxiliar', pin: '1234' }, request as never)).rejects.toThrow(
      'Solo los cargos habilitados para liderar pueden tener un PIN de acceso.',
    );
    expect(tx.collaborator.update).not.toHaveBeenCalled();
  });
});
