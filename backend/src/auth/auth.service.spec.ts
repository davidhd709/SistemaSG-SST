import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService.rotateRefresh (AUD-011)', () => {
  const request = { ip: '127.0.0.1', header: () => 'test-agent' };

  function context() {
    let revoked = false;
    const tx = {
      refreshSession: {
        updateMany: jest.fn().mockImplementation(() => {
          if (revoked) return { count: 0 };
          revoked = true;
          return { count: 1 };
        }),
        create: jest.fn().mockResolvedValue({ id: 'next-session' }),
      },
    };
    const prisma = {
      refreshSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'original-session',
          userId: 'user-1',
          collaboratorId: null,
          sessionType: 'ADMIN',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: { id: 'user-1', status: 'ACTIVE', lockedUntil: null },
          collaborator: null,
        }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-token') };
    const config = { get: jest.fn().mockReturnValue(undefined), getOrThrow: jest.fn().mockReturnValue('test-secret') };
    const service = new AuthService(prisma as never, jwt as never, config as never, {} as never);
    return { service, tx };
  }

  it('permite una sola rotación cuando llegan dos peticiones con la misma cookie', async () => {
    const { service, tx } = context();
    const results = await Promise.allSettled([
      service.rotateRefresh('same-token', request as never),
      service.rotateRefresh('same-token', request as never),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(tx.refreshSession.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.refreshSession.create).toHaveBeenCalledTimes(1);
    const update = tx.refreshSession.updateMany.mock.calls[0][0] as {
      where: { id: string; revokedAt: Date | null; expiresAt: { gt: Date } };
      data: { revokedAt: Date };
    };
    expect(update.where.id).toBe('original-session');
    expect(update.where.revokedAt).toBeNull();
    expect(update.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(update.data.revokedAt).toBeInstanceOf(Date);
  });

  it('no crea sesión nueva si el token fue consumido antes del compare-and-swap', async () => {
    const { service, tx } = context();
    tx.refreshSession.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.rotateRefresh('same-token', request as never)).rejects.toThrow(UnauthorizedException);
    expect(tx.refreshSession.create).not.toHaveBeenCalled();
  });
});
