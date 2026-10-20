import * as argon2 from 'argon2';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService.changeOwnPassword (AUD-012)', () => {
  const request = {
    principal: { kind: 'USER', userId: 'user-1' },
    ip: '127.0.0.1',
    header: () => 'test-agent',
    correlationId: 'request-1',
  };

  async function context(changedCount = 1) {
    const passwordHash = await argon2.hash('contraseña-actual-segura', { type: argon2.argon2id });
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: changedCount }) },
      refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', status: 'ACTIVE', passwordHash }) },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new UsersService(prisma as never), tx, prisma };
  }

  it('cambia su propia contraseña, desactiva el cambio forzado, revoca sesiones y audita sin guardar claves', async () => {
    const { service, tx } = await context();
    await expect(
      service.changeOwnPassword(
        { currentPassword: 'contraseña-actual-segura', newPassword: 'contraseña-nueva-segura' },
        request as never,
      ),
    ).resolves.toEqual({ changed: true });
    expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
    const revoked = tx.refreshSession.updateMany.mock.calls[0][0] as {
      where: { userId: string; revokedAt: Date | null };
      data: { revokedAt: Date };
    };
    expect(revoked.where).toEqual({ userId: 'user-1', revokedAt: null });
    expect(revoked.data.revokedAt).toBeInstanceOf(Date);
    const audit = tx.auditEvent.create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(audit.data.action).toBe('CHANGE_OWN_PASSWORD');
    expect(JSON.stringify(audit)).not.toContain('contraseña');
  });

  it('rechaza actores no administrativos, contraseña actual errónea y contraseña repetida', async () => {
    const { service, tx } = await context();
    await expect(
      service.changeOwnPassword({ currentPassword: 'x', newPassword: 'otra-clave-segura' }, {
        principal: { kind: 'COLLABORATOR' },
      } as never),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.changeOwnPassword({ currentPassword: 'incorrecta', newPassword: 'otra-clave-segura' }, request as never),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.changeOwnPassword(
        { currentPassword: 'contraseña-actual-segura', newPassword: 'contraseña-actual-segura' },
        request as never,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('no revoca sesiones ni audita si otra operación cambió primero la clave', async () => {
    const { service, tx } = await context(0);
    await expect(
      service.changeOwnPassword(
        { currentPassword: 'contraseña-actual-segura', newPassword: 'contraseña-nueva-segura' },
        request as never,
      ),
    ).rejects.toThrow(ConflictException);
    expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
