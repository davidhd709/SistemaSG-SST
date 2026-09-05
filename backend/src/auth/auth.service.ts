import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Collaborator, User } from '@prisma/client';
import type { RequestContext, AuthPrincipal } from '../common/request-context';
import { getNumber } from '../common/env';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { CollaboratorLoginDto } from './dto/collaborator-login.dto';

interface AccessPayload {
  sub: string;
  kind: 'USER' | 'COLLABORATOR';
}

export type SessionKind = 'ADMIN' | 'COLLABORATOR';

export interface LoginResult {
  kind: SessionKind;
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
}

/** @deprecated Conservado por compatibilidad; use `LoginResult`. */
export type AdminLoginResult = LoginResult;

@Injectable()
export class AuthService {
  private readonly maxAttempts: number;
  private readonly lockMinutes: number;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;
  private readonly collaboratorRefreshTtlSeconds: number;
  private readonly accessSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    this.maxAttempts = getNumber(config, 'AUTH_MAX_FAILED_ATTEMPTS', 5);
    this.lockMinutes = getNumber(config, 'AUTH_LOCK_MINUTES', 15);
    this.accessTtlSeconds = getNumber(config, 'JWT_ACCESS_TTL_SECONDS', 900);
    this.refreshTtlSeconds = getNumber(config, 'JWT_REFRESH_TTL_SECONDS', 604800);
    // El acceso operativo se usa en dispositivos compartidos en obra, así que su
    // sesión dura una jornada y no una semana como la administrativa.
    this.collaboratorRefreshTtlSeconds = getNumber(config, 'COLLABORATOR_REFRESH_TTL_SECONDS', 43200);
    this.accessSecret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  async loginAdmin(dto: AdminLoginDto, request: RequestContext): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await this.canAuthenticateUser(user, dto.password))) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        entityType: 'USER',
        entityId: user?.id ?? email,
        reason: 'Invalid credentials',
        ip: request.ip,
        userAgent: request.header('user-agent'),
        correlationId: request.correlationId ?? 'unknown',
      });
      throw new UnauthorizedException('Credenciales inválidas.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        sessionType: 'ADMIN',
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
        ip: request.ip,
        userAgent: request.header('user-agent'),
      },
    });
    await this.audit.record({
      actorUserId: user.id,
      action: 'LOGIN_SUCCEEDED',
      entityType: 'USER',
      entityId: user.id,
      ip: request.ip,
      userAgent: request.header('user-agent'),
      correlationId: request.correlationId ?? 'unknown',
    });
    return {
      kind: 'ADMIN',
      accessToken: await this.signAccess(user.id, 'USER'),
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      refreshExpiresIn: this.refreshTtlSeconds,
    };
  }

  async loginCollaborator(dto: CollaboratorLoginDto, request: RequestContext): Promise<LoginResult> {
    const documentNumber = dto.documentNumber.trim();
    const collaborator = await this.prisma.collaborator.findUnique({ where: { documentNumber } });
    if (!collaborator || !(await this.canAuthenticateCollaborator(collaborator, dto.pin))) {
      await this.audit.record({
        action: 'COLLABORATOR_LOGIN_FAILED',
        entityType: 'COLLABORATOR',
        entityId: collaborator?.id ?? documentNumber,
        reason: 'Invalid credentials',
        ip: request.ip,
        userAgent: request.header('user-agent'),
        correlationId: request.correlationId ?? 'unknown',
      });
      throw new UnauthorizedException('Documento o PIN inválido.');
    }
    await this.prisma.collaborator.update({
      where: { id: collaborator.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.audit.record({
      actorCollaboratorId: collaborator.id,
      action: 'COLLABORATOR_LOGIN_SUCCEEDED',
      entityType: 'COLLABORATOR',
      entityId: collaborator.id,
      ip: request.ip,
      userAgent: request.header('user-agent'),
      correlationId: request.correlationId ?? 'unknown',
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshSession.create({
      data: {
        collaboratorId: collaborator.id,
        sessionType: 'COLLABORATOR',
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.collaboratorRefreshTtlSeconds * 1000),
        ip: request.ip,
        userAgent: request.header('user-agent'),
      },
    });
    return {
      kind: 'COLLABORATOR',
      accessToken: await this.signAccess(collaborator.id, 'COLLABORATOR'),
      expiresIn: this.accessTtlSeconds,
      refreshToken,
      refreshExpiresIn: this.collaboratorRefreshTtlSeconds,
    };
  }

  async rotateRefresh(refreshToken: string | undefined, request: RequestContext): Promise<LoginResult> {
    // Sin cookie no hay nada que rotar: hashear `undefined` reventaba con un 500.
    if (!refreshToken) throw new UnauthorizedException('Sesión inválida o expirada.');
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: this.hashToken(refreshToken) },
      include: { user: true, collaborator: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }

    const esColaborador = session.sessionType === 'COLLABORATOR';
    const titular = esColaborador ? session.collaborator : session.user;
    // Una cuenta desactivada o bloqueada no debe poder renovar su sesión.
    if (!titular || titular.status !== 'ACTIVE' || this.isLocked(titular.lockedUntil)) {
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }

    const ttlSeconds = esColaborador ? this.collaboratorRefreshTtlSeconds : this.refreshTtlSeconds;
    const nuevoRefresh = randomBytes(48).toString('base64url');
    // Rotación: el token usado se revoca en el mismo paso en que nace su reemplazo.
    await this.prisma.$transaction([
      this.prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
      this.prisma.refreshSession.create({
        data: {
          userId: session.userId,
          collaboratorId: session.collaboratorId,
          sessionType: session.sessionType,
          tokenHash: this.hashToken(nuevoRefresh),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          ip: request.ip,
          userAgent: request.header('user-agent'),
        },
      }),
    ]);

    return {
      kind: esColaborador ? 'COLLABORATOR' : 'ADMIN',
      accessToken: await this.signAccess(titular.id, esColaborador ? 'COLLABORATOR' : 'USER'),
      expiresIn: this.accessTtlSeconds,
      refreshToken: nuevoRefresh,
      refreshExpiresIn: ttlSeconds,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async resolveAccessToken(payload: AccessPayload): Promise<AuthPrincipal> {
    if (payload.kind === 'COLLABORATOR') {
      const collaborator = await this.prisma.collaborator.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });
      if (collaborator?.status !== 'ACTIVE') throw new UnauthorizedException();
      return { kind: 'COLLABORATOR', collaboratorId: payload.sub };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        status: true,
        roles: {
          select: {
            role: { select: { code: true, permissions: { select: { permission: { select: { code: true } } } } } },
          },
        },
      },
    });
    if (user?.status !== 'ACTIVE') throw new UnauthorizedException();
    const roles = user.roles.map(({ role }) => role.code);
    const permissions = [
      ...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))),
    ];
    return { kind: 'USER', userId: payload.sub, roles, permissions };
  }

  private async signAccess(id: string, kind: AccessPayload['kind']): Promise<string> {
    return this.jwt.signAsync({ sub: id, kind }, { secret: this.accessSecret, expiresIn: this.accessTtlSeconds });
  }

  private async canAuthenticateUser(user: User, password: string): Promise<boolean> {
    if (user.status !== 'ACTIVE' || this.isLocked(user.lockedUntil)) return false;
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) await this.registerUserFailure(user);
    return valid;
  }

  private async canAuthenticateCollaborator(collaborator: Collaborator, pin: string): Promise<boolean> {
    if (
      collaborator.status !== 'ACTIVE' ||
      this.isLocked(collaborator.lockedUntil) ||
      !this.esOficialElectrico(collaborator.jobTitle) ||
      !collaborator.pinHash
    )
      return false;
    const valid = await argon2.verify(collaborator.pinHash, pin);
    if (!valid) await this.registerCollaboratorFailure(collaborator);
    return valid;
  }

  private esOficialElectrico(cargo: string | null): boolean {
    return (
      (cargo ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase() === 'OFICIAL ELECTRICO'
    );
  }

  private async registerUserFailure(user: User): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= this.maxAttempts ? new Date(Date.now() + this.lockMinutes * 60_000) : null,
      },
    });
  }

  private async registerCollaboratorFailure(collaborator: Collaborator): Promise<void> {
    const attempts = collaborator.failedLoginAttempts + 1;
    await this.prisma.collaborator.update({
      where: { id: collaborator.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= this.maxAttempts ? new Date(Date.now() + this.lockMinutes * 60_000) : null,
      },
    });
  }

  private isLocked(lockedUntil: Date | null): boolean {
    return Boolean(lockedUntil && lockedUntil > new Date());
  }
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
