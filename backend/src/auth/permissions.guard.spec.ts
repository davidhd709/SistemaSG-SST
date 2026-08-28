import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';

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
