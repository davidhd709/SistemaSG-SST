import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter Prisma mapping (AUD-030)', () => {
  function capture(exception: unknown) {
    let statusCode = 0;
    let responseBody: Record<string, unknown> = {};
    const response = {
      status: (status: number) => {
        statusCode = status;
        return {
          json: (body: Record<string, unknown>) => {
            responseBody = body;
          },
        };
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'PATCH', url: '/api/users/id', correlationId: 'request-1' }),
      }),
    } as unknown as Parameters<HttpExceptionFilter['catch']>[1];

    new HttpExceptionFilter().catch(exception, host);
    return { statusCode, responseBody };
  }

  it('convierte P2025 en 404 sin exponer detalles internos', () => {
    const result = capture(
      new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
        code: 'P2025',
        clientVersion: 'test',
      }),
    );
    expect(result.statusCode).toBe(404);
    expect(result.responseBody.message).toBe('El recurso solicitado no existe.');
  });

  it('convierte restricciones únicas y datos inválidos en respuestas de cliente', () => {
    const duplicate = capture(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const invalid = capture(
      new Prisma.PrismaClientKnownRequestError('Inconsistent column data.', {
        code: 'P2023',
        clientVersion: 'test',
      }),
    );
    expect(duplicate.statusCode).toBe(409);
    expect(invalid.statusCode).toBe(400);
  });
});
