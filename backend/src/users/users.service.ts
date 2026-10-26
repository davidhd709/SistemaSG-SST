import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { RegisterSignatureDto } from './dto/register-signature.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Firma registrada del usuario, para mostrarla antes de aprobar. */
  async mySignature(request: AuthenticatedRequest) {
    const userId = this.userId(request);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { fullName: true, signatureUpdatedAt: true, signatureFile: { select: { objectKey: true } } },
    });
    if (!user.signatureFile) return { fullName: user.fullName, updatedAt: null, dataUrl: null };
    const bytes = await this.storage.getObject(user.signatureFile.objectKey);
    return {
      fullName: user.fullName,
      updatedAt: user.signatureUpdatedAt,
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
    };
  }

  /**
   * Registra o reemplaza el nombre y la firma. El archivo anterior no se
   * borra: las aprobaciones ya hechas lo siguen referenciando como evidencia.
   */
  async registerSignature(dto: RegisterSignatureDto, request: AuthenticatedRequest) {
    const userId = this.userId(request);
    const fullName = dto.fullName.trim().replace(/\s+/g, ' ');
    if (fullName.length < 3) throw new BadRequestException('Escribe tu nombre completo.');
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dto.signatureDataUrl);
    const content = match ? Buffer.from(match[1], 'base64') : null;
    if (!content || content.length < 100 || content.length > 1_000_000 || content[0] !== 0x89 || content[1] !== 0x50) {
      throw new BadRequestException('La firma debe ser una imagen PNG válida.');
    }
    const stored = await this.storage.putObject({
      objectKey: `signatures/users/${randomUUID()}.png`,
      body: content,
      mimeType: 'image/png',
    });
    try {
      const updatedAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        const file = await tx.fileObject.create({
          data: {
            storageProvider: stored.storageProvider,
            bucket: stored.bucket,
            objectKey: stored.objectKey.replace(/\\/g, '/'),
            originalName: `firma-usuario-${userId}.png`,
            mimeType: 'image/png',
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            createdById: userId,
          },
        });
        await tx.user.update({
          where: { id: userId },
          data: { fullName, signatureFileId: file.id, signatureUpdatedAt: updatedAt },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: userId,
            action: 'REGISTER_SIGNATURE',
            entityType: 'USER',
            entityId: userId,
            afterJson: { fullName, fileId: file.id, sha256: stored.sha256 },
            ip: request.ip,
            userAgent: request.header('user-agent'),
            correlationId: request.correlationId ?? 'unknown',
          },
        });
      });
      return { fullName, updatedAt };
    } catch (error) {
      await this.storage.deleteObject(stored.objectKey).catch(() => undefined);
      throw error;
    }
  }

  private userId(request: AuthenticatedRequest): string {
    if (request.principal?.kind !== 'USER') throw new ForbiddenException();
    return request.principal.userId;
  }

  async changeOwnPassword(dto: ChangeOwnPasswordDto, request: AuthenticatedRequest) {
    const userId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    if (!userId) throw new ForbiddenException();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Contraseña actual incorrecta.');
    }
    if (await argon2.verify(user.passwordHash, dto.newPassword)) {
      throw new BadRequestException('La nueva contraseña debe ser diferente.');
    }
    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: userId, passwordHash: user.passwordHash, status: 'ACTIVE' },
        data: { passwordHash, forcePasswordChange: false },
      });
      if (changed.count !== 1) throw new ConflictException('La contraseña fue modificada por otra operación.');
      await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({
        data: {
          actorUserId: userId,
          action: 'CHANGE_OWN_PASSWORD',
          entityType: 'USER',
          entityId: userId,
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
    });
    return { changed: true };
  }

  async create(dto: CreateUserDto, request: AuthenticatedRequest) {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } }))
      throw new ConflictException('Ya existe un usuario con ese correo.');
    const roles = await this.prisma.role.findMany({ where: { code: { in: [...new Set(dto.roleCodes)] } } });
    if (roles.length !== new Set(dto.roleCodes).size) throw new BadRequestException('Uno o más roles no existen.');
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }),
          forcePasswordChange: true,
        },
      });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId: created.id, roleId: role.id })) });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'CREATE_USER',
          entityType: 'USER',
          entityId: created.id,
          afterJson: { email: created.email, roleCodes: roles.map((role) => role.code) },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return created;
    });
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      forcePasswordChange: user.forcePasswordChange,
      createdAt: user.createdAt,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        forcePasswordChange: true,
        fullName: true,
        signatureFileId: true,
        roles: {
          select: {
            role: {
              select: { code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } },
            },
          },
        },
      },
    });
    const { signatureFileId, ...datos } = user;
    return {
      ...datos,
      hasSignature: Boolean(signatureFileId),
      roles: user.roles.map(({ role }) => ({ code: role.code, name: role.name })),
      permissions: [
        ...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))),
      ],
    };
  }

  async listRoles() {
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { code: 'asc' },
    });
  }

  async list() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        roles: { select: { role: { select: { code: true, name: true } } } },
        refreshSessions: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return users.map(({ roles, refreshSessions, ...user }) => ({
      ...user,
      roles: roles.map(({ role }) => role),
      lastAccessAt: refreshSessions[0]?.createdAt ?? null,
    }));
  }

  async update(id: string, dto: UpdateUserDto, request: AuthenticatedRequest) {
    const previous = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    const email = dto.email?.trim().toLowerCase();
    if (email && email !== previous.email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) throw new ConflictException('Ya existe un usuario con ese correo.');
    }
    const roleCodes = dto.roleCodes ? [...new Set(dto.roleCodes)] : undefined;
    const roles = roleCodes ? await this.prisma.role.findMany({ where: { code: { in: roleCodes } } }) : undefined;
    if (roles && roles.length !== roleCodes!.length) throw new BadRequestException('Uno o más roles no existen.');
    const wasActiveAdmin = previous.status === 'ACTIVE' && previous.roles.some(({ role }) => role.code === 'ADMIN');
    const losesActiveAdmin =
      wasActiveAdmin && (dto.status === 'INACTIVE' || (roleCodes !== undefined && !roleCodes.includes('ADMIN')));
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (losesActiveAdmin) {
        const otherActiveAdmins = await tx.user.count({
          where: {
            id: { not: id },
            status: 'ACTIVE',
            roles: { some: { role: { code: 'ADMIN' } } },
          },
        });
        if (otherActiveAdmins === 0) {
          throw new BadRequestException(
            'No se puede inactivar ni retirar el rol ADMIN al último administrador activo.',
          );
        }
      }
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(email ? { email } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          // Una contraseña asignada por Administración es temporal: la persona
          // debe reemplazarla en su siguiente ingreso.
          ...(dto.password
            ? { passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }), forcePasswordChange: true }
            : {}),
        },
      });
      if (roles) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roles.map((role) => ({ userId: id, roleId: role.id })) });
      }
      if (dto.password || dto.status === 'INACTIVE' || roles) {
        await tx.refreshSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'UPDATE_USER',
          entityType: 'USER',
          entityId: id,
          beforeJson: {
            email: previous.email,
            status: previous.status,
            roleCodes: previous.roles.map(({ role }) => role.code),
          },
          afterJson: {
            email: user.email,
            status: user.status,
            roleCodes: roles?.map((role) => role.code) ?? undefined,
            ...(dto.password ? { passwordReset: true } : {}),
          },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return user;
    });
    return { id: updated.id, email: updated.email, status: updated.status, createdAt: updated.createdAt };
  }
}
