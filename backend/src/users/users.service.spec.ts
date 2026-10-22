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

  describe('UsersService.update — protección del último administrador (AUD-018)', () => {
    function setupUpdate(otherActiveAdmins: number) {
      const previous = {
        id: 'admin-1',
        email: 'admin@local.test',
        status: 'ACTIVE',
        createdAt: new Date(),
        roles: [{ role: { id: 'r-admin', code: 'ADMIN', name: 'Administrador' } }],
      };
      const tx = {
        user: {
          count: jest.fn().mockResolvedValue(otherActiveAdmins),
          update: jest.fn().mockImplementation(({ data }: { data: { status?: string } }) =>
            Promise.resolve({
              ...previous,
              status: data.status ?? previous.status,
            }),
          ),
        },
        userRole: {
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        auditEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(previous),
          findUnique: jest.fn().mockResolvedValue(null),
        },
        role: {
          findMany: jest
            .fn()
            .mockImplementation(({ where }: { where: { code: { in: string[] } } }) =>
              Promise.resolve(where.code.in.map((code) => ({ id: `r-${code}`, code, name: code }))),
            ),
        },
        $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
      };
      return { service: new UsersService(prisma as never), tx };
    }

    it('rechaza inactivar o retirar el rol ADMIN cuando es el último administrador activo', async () => {
      const { service, tx } = setupUpdate(0);
      await expect(service.update('admin-1', { status: 'INACTIVE' }, request as never)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('admin-1', { roleCodes: ['COORDINATOR'] }, request as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.refreshSession.updateMany).not.toHaveBeenCalled();
    });

    it('permite inactivar o cambiar roles de un administrador cuando existe otro administrador activo', async () => {
      const { service, tx } = setupUpdate(1);
      await expect(service.update('admin-1', { status: 'INACTIVE' }, request as never)).resolves.toMatchObject({
        id: 'admin-1',
        status: 'INACTIVE',
      });
      expect(tx.user.update).toHaveBeenCalledTimes(1);
      expect(tx.refreshSession.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  it('una contraseña restablecida por Administración es temporal, revoca sesiones y se audita sin la clave', async () => {
    const previous = {
      id: 'user-2',
      email: 'coordinacion@local.test',
      status: 'ACTIVE',
      createdAt: new Date(),
      roles: [{ role: { id: 'r-coord', code: 'COORDINATOR', name: 'Coordinación' } }],
    };
    const tx = {
      user: { count: jest.fn(), update: jest.fn().mockResolvedValue(previous) },
      userRole: { deleteMany: jest.fn(), createMany: jest.fn() },
      refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue(previous), findUnique: jest.fn() },
      role: { findMany: jest.fn() },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new UsersService(prisma as never);

    await service.update('user-2', { password: 'Temporal-segura-2026' }, request as never);

    const { data } = tx.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.forcePasswordChange).toBe(true);
    expect(data.passwordHash).toEqual(expect.any(String));
    expect(tx.refreshSession.updateMany).toHaveBeenCalledTimes(1);
    const auditoria = JSON.stringify(tx.auditEvent.create.mock.calls[0][0]);
    expect(auditoria).toContain('"passwordReset":true');
    expect(auditoria).not.toContain('Temporal-segura-2026');
  });
});
