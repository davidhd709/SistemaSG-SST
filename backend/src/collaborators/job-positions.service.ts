import { ConflictException, Injectable } from '@nestjs/common';
import type { JobPosition } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobPositionDto } from './dto/create-job-position.dto';
import { UpdateJobPositionDto } from './dto/update-job-position.dto';

/**
 * Catálogo de cargos. Dos de sus propiedades tienen efecto inmediato sobre la
 * operación: `canLead` decide quién puede ingresar con PIN y abrir permisos, y
 * `requiresHeightCertificate` decide a quién se le exige el curso de alturas.
 */
@Injectable()
export class JobPositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const cargos = await this.prisma.jobPosition.findMany({
      include: { collaborators: { where: { status: 'ACTIVE' }, select: { pinHash: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return cargos.map(({ collaborators, ...cargo }) => ({
      ...cargo,
      activeCollaborators: collaborators.length,
      // Con `canLead` activo, quien no tiene PIN todavía no puede ingresar.
      withoutPin: cargo.canLead ? collaborators.filter((persona) => !persona.pinHash).length : 0,
    }));
  }

  async create(dto: CreateJobPositionDto, request: AuthenticatedRequest) {
    const name = dto.name.trim();
    await this.verificarNombreLibre(name);
    if (await this.prisma.jobPosition.findUnique({ where: { code: dto.code } })) {
      throw new ConflictException('Ya existe un cargo con ese código.');
    }
    return this.prisma.$transaction(async (tx) => {
      const cargo = await tx.jobPosition.create({
        data: {
          code: dto.code,
          name,
          canLead: dto.canLead ?? false,
          requiresHeightCertificate: dto.requiresHeightCertificate ?? false,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId: this.actor(request),
          action: 'CREATE_JOB_POSITION',
          entityType: 'JOB_POSITION',
          entityId: cargo.id,
          afterJson: this.auditData(cargo),
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return cargo;
    });
  }

  async update(id: string, dto: UpdateJobPositionDto, request: AuthenticatedRequest) {
    const anterior = await this.prisma.jobPosition.findUniqueOrThrow({ where: { id } });
    const name = dto.name?.trim();
    if (name && name.toLowerCase() !== anterior.name.toLowerCase()) await this.verificarNombreLibre(name, id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.active === false && anterior.active) {
        const asignados = await tx.collaborator.count({ where: { jobPositionId: id, status: 'ACTIVE' } });
        if (asignados > 0) {
          const quienes = asignados === 1 ? 'colaborador activo' : 'colaboradores activos';
          throw new ConflictException(`Reasigna a ${asignados} ${quienes} antes de desactivar este cargo.`);
        }
      }
      const cargo = await tx.jobPosition.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(dto.canLead !== undefined ? { canLead: dto.canLead } : {}),
          ...(dto.requiresHeightCertificate !== undefined
            ? { requiresHeightCertificate: dto.requiresHeightCertificate }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      // El nombre del cargo también se guarda como texto en cada colaborador.
      if (name && name !== anterior.name) {
        await tx.collaborator.updateMany({ where: { jobPositionId: id }, data: { jobTitle: name } });
      }
      // Sin liderazgo nadie de este cargo puede conservar una sesión abierta.
      let sesionesRevocadas = 0;
      if (anterior.canLead && !cargo.canLead) {
        const revocadas = await tx.refreshSession.updateMany({
          where: { revokedAt: null, collaborator: { jobPositionId: id } },
          data: { revokedAt: new Date() },
        });
        sesionesRevocadas = revocadas.count;
      }
      await tx.auditEvent.create({
        data: {
          actorUserId: this.actor(request),
          action: 'UPDATE_JOB_POSITION',
          entityType: 'JOB_POSITION',
          entityId: id,
          beforeJson: this.auditData(anterior),
          afterJson: { ...this.auditData(cargo), ...(sesionesRevocadas ? { sesionesRevocadas } : {}) },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return cargo;
    });
  }

  /** El nombre identifica al cargo ante las personas: no puede repetirse. */
  private async verificarNombreLibre(name: string, exceptoId?: string): Promise<void> {
    const repetido = await this.prisma.jobPosition.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptoId ? { id: { not: exceptoId } } : {}) },
      select: { id: true },
    });
    if (repetido) throw new ConflictException('Ya existe un cargo con ese nombre.');
  }

  private actor(request: AuthenticatedRequest): string | undefined {
    return request.principal?.kind === 'USER' ? request.principal.userId : undefined;
  }

  private auditData(cargo: JobPosition) {
    return {
      code: cargo.code,
      name: cargo.name,
      canLead: cargo.canLead,
      requiresHeightCertificate: cargo.requiresHeightCertificate,
      active: cargo.active,
    };
  }
}
