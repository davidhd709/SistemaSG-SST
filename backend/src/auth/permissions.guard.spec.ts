import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { Reflector } from '@nestjs/core';
import { CollaboratorsController } from '../collaborators/collaborators.controller';
import { UsersController } from '../users/users.controller';

describe('PermissionsGuard', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['arl:manage']) };
  const guard = new PermissionsGuard(reflector as never);
  const context = (principal: unknown) => ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  });
  it('permits a user with the required permission', () =>
    expect(
      guard.canActivate(context({ kind: 'USER', userId: 'u', roles: [], permissions: ['arl:manage'] }) as never),
    ).toBe(true));
  it('returns 403 for an unauthorized principal', () =>
    expect(() =>
      guard.canActivate(context({ kind: 'USER', userId: 'u', roles: [], permissions: [] }) as never),
    ).toThrow(ForbiddenException));
});

describe('CollaboratorsController update authorization', () => {
  const guard = new PermissionsGuard(new Reflector());
  const context = (permissions: string[]) => ({
    getHandler: () => Reflect.get(CollaboratorsController.prototype, 'update') as () => unknown,
    getClass: () => CollaboratorsController,
    switchToHttp: () => ({ getRequest: () => ({ principal: { kind: 'USER', permissions } }) }),
  });

  it('rejects read-only access and permits collaborator management', () => {
    expect(() => guard.canActivate(context(['collaborators:read']) as never)).toThrow(ForbiddenException);
    expect(guard.canActivate(context(['collaborators:manage']) as never)).toBe(true);
  });
});

describe('UsersController update authorization', () => {
  const guard = new PermissionsGuard(new Reflector());
  const context = (permissions: string[]) => ({
    getHandler: () => Reflect.get(UsersController.prototype, 'update') as () => unknown,
    getClass: () => UsersController,
    switchToHttp: () => ({ getRequest: () => ({ principal: { kind: 'USER', permissions } }) }),
  });

  it('rejects read-only access and permits user management', () => {
    expect(() => guard.canActivate(context(['users:read']) as never)).toThrow(ForbiddenException);
    expect(guard.canActivate(context(['users:manage']) as never)).toBe(true);
  });
});
