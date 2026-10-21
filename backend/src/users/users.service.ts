import * as argon2 from 'argon2';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
        roles: {
          select: {
            role: {
              select: { code: true, name: true, permissions: { select: { permission: { select: { code: true } } } } },
            },
          },
        },
      },
    });
    return {
      ...user,
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
          ...(dto.password ? { passwordHash: await argon2.hash(dto.password, { type: argon2.argon2id }) } : {}),
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
