import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SkipThrottle,
  Throttle,
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';

class TestController {
  standardEndpoint(): string {
    return 'ok';
  }

  loginEndpoint(): string {
    return 'logged_in';
  }

  skippedEndpoint(): string {
    return 'always_allowed';
  }
}

// Decoradores aplicados a los métodos de prueba
Throttle({ default: { limit: 2, ttl: 60_000 } })(
  TestController.prototype,
  'loginEndpoint',
  Object.getOwnPropertyDescriptor(TestController.prototype, 'loginEndpoint')!,
);

SkipThrottle()(
  TestController.prototype,
  'skippedEndpoint',
  Object.getOwnPropertyDescriptor(TestController.prototype, 'skippedEndpoint')!,
);

describe('ThrottlerGuard & Rate Limiting (AUD-001)', () => {
  let guard: ThrottlerGuard;
  let reflector: Reflector;
  let storage: ThrottlerStorageService;

  beforeEach(async () => {
    reflector = new Reflector();
    storage = new ThrottlerStorageService();
    guard = new ThrottlerGuard(
      [
        {
          name: 'default',
          limit: 3,
          ttl: 60_000,
        },
      ],
      storage,
      reflector,
    );
    await guard.onModuleInit();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
  });

  const createContext = (
    methodName: keyof TestController,
    ip = '192.168.1.100',
    headers: Record<string, string> = {},
  ): ExecutionContext => {
    const req = {
      ip,
      headers,
      url: `/api/${String(methodName)}`,
      correlationId: 'corr-throttler-test-123',
      header: (name: string) => headers[name.toLowerCase()],
    };
    const res = {
      header: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    return {
      getHandler: () => TestController.prototype[methodName],
      getClass: () => TestController,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
  };

  describe('1. Caso normal y exceso de solicitudes global', () => {
    it('permite solicitudes dentro del límite global (límite = 3)', async () => {
      const ctx = createContext('standardEndpoint');
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('lanza ThrottlerException (HTTP 429) al superar el límite global', async () => {
      const ctx = createContext('standardEndpoint', '10.0.0.1');
      await guard.canActivate(ctx);
      await guard.canActivate(ctx);
      await guard.canActivate(ctx);

      await expect(guard.canActivate(ctx)).rejects.toThrow(ThrottlerException);
      await expect(guard.canActivate(ctx)).rejects.toThrow('Too Many Requests');
    });

    it('aísla los límites por dirección IP', async () => {
      const ctxIpA = createContext('standardEndpoint', '10.0.0.2');
      const ctxIpB = createContext('standardEndpoint', '10.0.0.3');

      // Agotar cuota para IP A
      await guard.canActivate(ctxIpA);
      await guard.canActivate(ctxIpA);
      await guard.canActivate(ctxIpA);
      await expect(guard.canActivate(ctxIpA)).rejects.toThrow(ThrottlerException);

      // IP B todavía tiene su cuota completa
      expect(await guard.canActivate(ctxIpB)).toBe(true);
    });
  });

  describe('2. Política específica para Login (@Throttle)', () => {
    it('aplica el límite estricto de login (límite = 2) y bloquea al 3er intento', async () => {
      const ctx = createContext('loginEndpoint', '172.16.0.5');

      expect(await guard.canActivate(ctx)).toBe(true);
      expect(await guard.canActivate(ctx)).toBe(true);

      // El 3er intento debe ser rechazado inmediatamente
      await expect(guard.canActivate(ctx)).rejects.toThrow(ThrottlerException);
    });
  });

  describe('3. Rutas con @SkipThrottle', () => {
    it('permite llamadas indefinidas en endpoints marcados con @SkipThrottle', async () => {
      const ctx = createContext('skippedEndpoint', '192.168.1.50');

      for (let i = 0; i < 10; i++) {
        expect(await guard.canActivate(ctx)).toBe(true);
      }
    });
  });

  describe('4. Observabilidad y formato de error 429 (HttpExceptionFilter)', () => {
    it('HttpExceptionFilter formatea el 429 con correlationId y sin exponer datos sensibles', () => {
      const filter = new HttpExceptionFilter();
      let responseBody: Record<string, unknown> = {};
      let statusCode = 0;

      const mockResponse = {
        status: (code: number) => {
          statusCode = code;
          return {
            json: (body: Record<string, unknown>) => {
              responseBody = body;
            },
          };
        },
      };

      const mockRequest = {
        url: '/api/auth/collaborator/login',
        correlationId: 'test-correlation-xyz-789',
      };

      const host = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => mockRequest,
        }),
      } as unknown as Parameters<HttpExceptionFilter['catch']>[1];

      filter.catch(new ThrottlerException('Has superado el límite de solicitudes.'), host);

      expect(statusCode).toBe(429);
      expect(responseBody).toEqual({
        statusCode: 429,
        message: 'Has superado el límite de solicitudes.',
        timestamp: expect.any(String),
        path: '/api/auth/collaborator/login',
        correlationId: 'test-correlation-xyz-789',
      });
    });
  });

  describe('5. Interacción con guards existentes (AuthGuard y PermissionsGuard)', () => {
    it('PermissionsGuard sigue denegando acceso no autorizado cuando ThrottlerGuard lo aprueba', async () => {
      const permissionsReflector = { getAllAndOverride: jest.fn().mockReturnValue(['arl:manage']) };
      const permissionsGuard = new PermissionsGuard(permissionsReflector as never);

      const ctx = createContext('standardEndpoint', '10.0.0.8');

      // 1. Pasa por ThrottlerGuard
      const throttlerPassed = await guard.canActivate(ctx);
      expect(throttlerPassed).toBe(true);

      // 2. Continúa hacia PermissionsGuard con principal sin permisos
      const authContext = {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({
          getRequest: () => ({ principal: { kind: 'USER', userId: 'u1', roles: [], permissions: [] } }),
        }),
      };

      expect(() => permissionsGuard.canActivate(authContext as never)).toThrow(ForbiddenException);
    });

    it('AuthGuard deniega peticiones sin token cuando ThrottlerGuard lo aprueba', async () => {
      const authReflector = { getAllAndOverride: jest.fn().mockReturnValue(false) }; // No public
      const jwtService = { verifyAsync: jest.fn() };
      const authService = { resolveAccessToken: jest.fn() };
      const configService = { getOrThrow: jest.fn().mockReturnValue('secret') };

      const authGuard = new AuthGuard(
        authReflector as never,
        jwtService as never,
        authService as never,
        configService as never,
      );

      const ctx = createContext('standardEndpoint', '10.0.0.9');

      // 1. Pasa por ThrottlerGuard
      expect(await guard.canActivate(ctx)).toBe(true);

      // 2. Continúa hacia AuthGuard sin cabecera Authorization
      const reqSinToken = {
        header: () => undefined,
      };
      const authContext = {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({
          getRequest: () => reqSinToken,
        }),
      };

      await expect(authGuard.canActivate(authContext as never)).rejects.toThrow(UnauthorizedException);
    });
  });
});
