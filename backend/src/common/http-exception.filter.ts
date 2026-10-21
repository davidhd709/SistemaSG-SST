import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import type { RequestContext } from './request-context';

type MappedPrismaError = { status: number; message: string };

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<RequestContext>();
    const isHttpException = exception instanceof HttpException;
    const prismaError = this.mapPrismaError(exception);
    const status = isHttpException ? exception.getStatus() : (prismaError?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
    const raw = isHttpException ? exception.getResponse() : (prismaError?.message ?? 'Error interno del servidor.');
    const message =
      typeof raw === 'object' && raw !== null && 'message' in raw ? (raw as { message: unknown }).message : raw;

    if ((!isHttpException && !prismaError) || status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `[${request.method ?? 'HTTP'} ${request.url ?? ''}] ${err.message} (CorrelationId: ${request.correlationId ?? 'unknown'})`,
        err.stack,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId: request.correlationId,
    });
  }

  private mapPrismaError(exception: unknown): MappedPrismaError | undefined {
    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
    switch (exception.code) {
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, message: 'El recurso solicitado no existe.' };
      case 'P2002':
        return { status: HttpStatus.CONFLICT, message: 'Ya existe un registro con esos datos.' };
      case 'P2003':
      case 'P2014':
        return { status: HttpStatus.CONFLICT, message: 'La operación entra en conflicto con registros relacionados.' };
      case 'P2000':
      case 'P2006':
      case 'P2011':
      case 'P2012':
      case 'P2013':
      case 'P2019':
      case 'P2023':
        return { status: HttpStatus.BAD_REQUEST, message: 'Los datos enviados no son válidos.' };
      default:
        return undefined;
    }
  }
}
