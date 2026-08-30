import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { ComplianceService } from './compliance.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { CreateHeightCertificateDto } from './dto/create-height-certificate.dto';

type Archivo = { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined;

/**
 * Gestión de los requisitos que habilitan a un colaborador para subir: la
 * planilla de seguridad social y el certificado de alturas. Los administra
 * Coordinación, y de su vigencia depende quién puede integrar una cuadrilla.
 */
@Injectable()
export class ComplianceAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly compliance: ComplianceService,
  ) {}

  // ── Panorama general ─────────────────────────────────────────────────
  /** Estado de cumplimiento de toda la plantilla, para ver a quién le falta. */
  async overview() {
    const colaboradores = await this.prisma.collaborator.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, documentNumber: true, jobTitle: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const cumplimientos = await this.compliance.evaluar(colaboradores.map((persona) => persona.id));
    const filas = colaboradores.map((persona) => ({
      collaborator: persona,
      cumplimiento: cumplimientos.get(persona.id)!,
    }));
    return {
      rows: filas,
      aptos: filas.filter((fila) => fila.cumplimiento.apto).length,
      bloqueados: filas.filter((fila) => !fila.cumplimiento.apto).length,
    };
  }

  // ── Planillas de seguridad social ────────────────────────────────────
  async listPayrolls() {
    const planillas = await this.prisma.socialSecurityPayroll.findMany({
      include: {
        memberships: { include: { collaborator: { select: { id: true, firstName: true, lastName: true } } } },
        file: { select: { id: true, originalName: true } },
      },
      orderBy: { periodEnd: 'desc' },
      take: 100,
    });
    return planillas.map((planilla) => ({
      id: planilla.id,
      reference: planilla.reference,
      providerName: planilla.providerName,
      periodStart: planilla.periodStart,
      periodEnd: planilla.periodEnd,
      file: planilla.file,
      members: planilla.memberships.map(({ collaborator }) => collaborator),
    }));
  }

  async createPayroll(dto: CreatePayrollDto, request: AuthenticatedRequest) {
    const periodStart = this.fecha(dto.periodStart);
    const periodEnd = this.fecha(dto.periodEnd);
    if (periodEnd < periodStart) throw new BadRequestException('El fin del periodo no puede ser anterior al inicio.');
    await this.verificarColaboradores(dto.collaboratorIds);
    const actorUserId = this.actor(request);

    return this.prisma.$transaction(async (tx) => {
      const planilla = await tx.socialSecurityPayroll.create({
        data: {
          reference: dto.reference.trim(),
          providerName: dto.providerName?.trim(),
          periodStart,
          periodEnd,
          createdById: actorUserId,
        },
      });
      await tx.payrollMembership.createMany({
        data: dto.collaboratorIds.map((collaboratorId) => ({ payrollId: planilla.id, collaboratorId })),
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'CREATE_PAYROLL',
          entityType: 'SOCIAL_SECURITY_PAYROLL',
          entityId: planilla.id,
          afterJson: {
            reference: planilla.reference,
            periodStart: dto.periodStart,
            periodEnd: dto.periodEnd,
            members: dto.collaboratorIds.length,
          },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return planilla;
    });
  }

  /**
   * Renueva una planilla. Cuando solo algunos integrantes continúan, se envía
   * la lista reducida: los que no aparecen dejan de estar cubiertos por ella.
   */
  async updatePayroll(id: string, dto: UpdatePayrollDto, request: AuthenticatedRequest) {
    const existente = await this.prisma.socialSecurityPayroll.findUnique({
      where: { id },
      include: { memberships: true },
    });
    if (!existente) throw new NotFoundException('Planilla no encontrada.');
    const periodStart = dto.periodStart ? this.fecha(dto.periodStart) : existente.periodStart;
    const periodEnd = dto.periodEnd ? this.fecha(dto.periodEnd) : existente.periodEnd;
    if (periodEnd < periodStart) throw new BadRequestException('El fin del periodo no puede ser anterior al inicio.');
    if (dto.collaboratorIds) await this.verificarColaboradores(dto.collaboratorIds);
    const actorUserId = this.actor(request);

    return this.prisma.$transaction(async (tx) => {
      const actualizada = await tx.socialSecurityPayroll.update({
        where: { id },
        data: {
          reference: dto.reference?.trim(),
          providerName: dto.providerName?.trim(),
          periodStart,
          periodEnd,
        },
      });
      if (dto.collaboratorIds) {
        await tx.payrollMembership.deleteMany({ where: { payrollId: id } });
        await tx.payrollMembership.createMany({
          data: dto.collaboratorIds.map((collaboratorId) => ({ payrollId: id, collaboratorId })),
        });
      }
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'UPDATE_PAYROLL',
          entityType: 'SOCIAL_SECURITY_PAYROLL',
          entityId: id,
          beforeJson: {
            reference: existente.reference,
            periodEnd: existente.periodEnd.toISOString().slice(0, 10),
            members: existente.memberships.length,
          },
          afterJson: {
            reference: actualizada.reference,
            periodEnd: periodEnd.toISOString().slice(0, 10),
            members: dto.collaboratorIds?.length ?? existente.memberships.length,
          },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return actualizada;
    });
  }

  async attachPayrollFile(id: string, upload: Archivo, request: AuthenticatedRequest) {
    const planilla = await this.prisma.socialSecurityPayroll.findUnique({ where: { id } });
    if (!planilla) throw new NotFoundException('Planilla no encontrada.');
    const file = await this.guardarSoporte(upload, `payrolls/${id}`, this.actor(request));
    await this.prisma.$transaction([
      this.prisma.socialSecurityPayroll.update({ where: { id }, data: { fileId: file.id } }),
      this.prisma.auditEvent.create({
        data: {
          actorUserId: this.actor(request),
          action: 'UPLOAD_PAYROLL_FILE',
          entityType: 'SOCIAL_SECURITY_PAYROLL',
          entityId: id,
          evidenceFileId: file.id,
          afterJson: { fileId: file.id, sha256: file.sha256 },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      }),
    ]);
    return { fileId: file.id, sha256: file.sha256 };
  }

  // ── Certificados de trabajo en alturas ───────────────────────────────
  async listHeightCertificates(collaboratorId?: string) {
    return this.prisma.heightCertificate.findMany({
      where: collaboratorId ? { collaboratorId } : {},
      include: {
        collaborator: { select: { id: true, firstName: true, lastName: true, documentNumber: true } },
        file: { select: { id: true, originalName: true } },
      },
      orderBy: { expiresAt: 'desc' },
      take: 200,
    });
  }

  async createHeightCertificate(dto: CreateHeightCertificateDto, request: AuthenticatedRequest) {
    const issuedAt = this.fecha(dto.issuedAt);
    const expiresAt = this.fecha(dto.expiresAt);
    if (expiresAt < issuedAt) throw new BadRequestException('El vencimiento no puede ser anterior a la expedición.');
    await this.verificarColaboradores([dto.collaboratorId]);
    const actorUserId = this.actor(request);

    return this.prisma.$transaction(async (tx) => {
      const certificado = await tx.heightCertificate.create({
        data: {
          collaboratorId: dto.collaboratorId,
          issuedAt,
          expiresAt,
          trainingEntity: dto.trainingEntity?.trim(),
          createdById: actorUserId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'CREATE_HEIGHT_CERTIFICATE',
          entityType: 'HEIGHT_CERTIFICATE',
          entityId: certificado.id,
          afterJson: { collaboratorId: dto.collaboratorId, issuedAt: dto.issuedAt, expiresAt: dto.expiresAt },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return certificado;
    });
  }

  async attachCertificateFile(id: string, upload: Archivo, request: AuthenticatedRequest) {
    const certificado = await this.prisma.heightCertificate.findUnique({ where: { id } });
    if (!certificado) throw new NotFoundException('Certificado no encontrado.');
    const file = await this.guardarSoporte(upload, `height-certificates/${id}`, this.actor(request));
    await this.prisma.$transaction([
      this.prisma.heightCertificate.update({ where: { id }, data: { fileId: file.id } }),
      this.prisma.auditEvent.create({
        data: {
          actorUserId: this.actor(request),
          action: 'UPLOAD_HEIGHT_CERTIFICATE_FILE',
          entityType: 'HEIGHT_CERTIFICATE',
          entityId: id,
          evidenceFileId: file.id,
          afterJson: { fileId: file.id, sha256: file.sha256 },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      }),
    ]);
    return { fileId: file.id, sha256: file.sha256 };
  }

  // ── Interno ──────────────────────────────────────────────────────────
  /**
   * Guarda un soporte validando su contenido real, no solo la extensión: el
   * tipo declarado por el navegador se puede falsear.
   */
  private async guardarSoporte(upload: Archivo, prefijo: string, actorUserId?: string) {
    if (!upload?.buffer || upload.size <= 0 || upload.size > 10 * 1024 * 1024) {
      throw new BadRequestException('El soporte debe pesar máximo 10 MB.');
    }
    const mimeType = this.detectarTipo(upload.buffer);
    if (!mimeType || mimeType !== upload.mimetype) {
      throw new BadRequestException('El archivo debe ser PDF, JPG o PNG.');
    }
    const stored = await this.storage.putObject({
      objectKey: `${prefijo}/${randomUUID()}`,
      body: upload.buffer,
      mimeType,
    });
    try {
      return await this.prisma.fileObject.create({
        data: {
          storageProvider: stored.storageProvider,
          bucket: stored.bucket,
          objectKey: stored.objectKey.replace(/\\/g, '/'),
          originalName: upload.originalname.slice(0, 255),
          mimeType,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          createdById: actorUserId,
        },
      });
    } catch (error) {
      await this.storage.deleteObject(stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  private detectarTipo(contenido: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
    if (contenido.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
    if (contenido[0] === 0x89 && contenido[1] === 0x50) return 'image/png';
    if (contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff) return 'image/jpeg';
    return null;
  }

  private async verificarColaboradores(ids: string[]): Promise<void> {
    const unicos = [...new Set(ids)];
    const existentes = await this.prisma.collaborator.count({ where: { id: { in: unicos } } });
    if (existentes !== unicos.length) throw new BadRequestException('Uno o más colaboradores no existen.');
  }

  private fecha(valor: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw new BadRequestException('La fecha debe tener formato AAAA-MM-DD.');
    const parsed = new Date(`${valor}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Fecha inválida.');
    return parsed;
  }

  private actor(request: AuthenticatedRequest): string | undefined {
    return request.principal?.kind === 'USER' ? request.principal.userId : undefined;
  }
}
