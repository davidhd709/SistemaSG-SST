import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { ComplianceService, type Cumplimiento } from '../compliance/compliance.service';
import { PdfService } from '../pdf/pdf.service';
import { SubmitFormDto, type CrewMemberDto } from './dto/submit-form.dto';
import { CloseWorkdayDto } from './dto/close-workday.dto';
import { businessDate, businessDay } from '../common/business-date';

type Field = { id?: unknown; type?: unknown; required?: unknown; options?: unknown; source?: unknown };
const safetyTalkVideos: Record<string, { minimumSeconds: number; sha256: string }> = {
  'charla-01': { minimumSeconds: 54, sha256: '8529d57c4941486221dca0a4987d24f6268640b003b04b593e53ef9d7fae2938' },
  'charla-02': { minimumSeconds: 54, sha256: '781e2e4df27db5cf430dd18f19ded042405a78b1836274e47a1ee71f9e4c6c92' },
  'charla-03': { minimumSeconds: 11, sha256: '22d9e4e6adcbd5d52aa2a22a3019e77b74fc372c28cf5fb18b9d30a6fb78057c' },
};

type SafetyTalkPayload = {
  sub: string;
  jti: string;
  purpose: 'SAFETY_TALK';
  videoId: string;
  videoSha256: string;
  iat: number;
};

/** De dónde sale el valor de un campo que el sistema resuelve por su cuenta. */
type Origen = 'workDate' | 'startedAt' | 'closedAt' | 'heightCertificate' | 'socialSecurity';

/** Firma ya guardada en el almacén, lista para asociarse a su integrante. */
type FirmaGuardada = {
  collaboratorId: string;
  jobPositionId?: string;
  objectKey: string;
  storageProvider: string;
  bucket: string;
  sizeBytes: number;
  sha256: string;
};

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly compliance: ComplianceService,
    private readonly pdf: PdfService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async safetyTalkChallenge(videoId: string, request: AuthenticatedRequest) {
    const collaboratorId = this.collaboratorId(request);
    const video = safetyTalkVideos[videoId];
    if (!video) throw new BadRequestException('Charla de seguridad no disponible.');
    return {
      token: await this.jwt.signAsync(
        { sub: collaboratorId, jti: randomUUID(), purpose: 'SAFETY_TALK', videoId, videoSha256: video.sha256 },
        { secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'), expiresIn: 43_200 },
      ),
      minimumSeconds: video.minimumSeconds,
    };
  }

  private async validateSafetyTalk(token: string, collaboratorId: string): Promise<SafetyTalkPayload> {
    let payload: SafetyTalkPayload;
    try {
      payload = await this.jwt.verifyAsync<SafetyTalkPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new ForbiddenException('La confirmación de la charla no es válida o expiró.');
    }
    const video = safetyTalkVideos[payload.videoId];
    if (
      payload.purpose !== 'SAFETY_TALK' ||
      payload.sub !== collaboratorId ||
      !video ||
      payload.videoSha256 !== video.sha256 ||
      !/^[0-9a-f-]{36}$/i.test(payload.jti) ||
      !Number.isInteger(payload.iat) ||
      businessDay(new Date(payload.iat * 1000)) !== businessDay(new Date()) ||
      Date.now() < (payload.iat + video.minimumSeconds) * 1000
    ) {
      throw new ForbiddenException('Completa la charla antes de confirmar el permiso.');
    }
    return payload;
  }

  /** Estado del oficial que abre el permiso y su propio cumplimiento. */
  async workflow(request: AuthenticatedRequest) {
    await this.expireStalePermits();
    const collaboratorId = this.collaboratorId(request);
    const collaborator = await this.prisma.collaborator.findUnique({ where: { id: collaboratorId } });
    if (!collaborator) throw new NotFoundException();
    const cumplimiento = await this.compliance.evaluarUno(collaboratorId);
    const abierta = await this.jornadaAbierta(collaboratorId);

    return {
      collaborator: {
        firstName: collaborator.firstName,
        lastName: collaborator.lastName,
        documentNumber: collaborator.documentNumber,
      },
      arl: {
        providerName: cumplimiento.arl.providerName,
        endDate: cumplimiento.arl.endDate,
        status: cumplimiento.arl.estado,
      },
      cumplimiento,
      // No se abre un permiso nuevo mientras haya una jornada sin cerrar.
      jornadaAbierta: abierta && { id: abierta.id, workDate: abierta.workDate, startedAt: abierta.startedAt },
      canContinue: cumplimiento.apto && !abierta,
    };
  }

  /**
   * Colaboradores que hoy pueden integrar una cuadrilla. Quien no cumple los
   * tres requisitos no aparece: el oficial no debería poder elegirlo por error.
   */
  async crewCandidates(request: AuthenticatedRequest) {
    this.collaboratorId(request);
    const activos = await this.prisma.collaborator.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, documentNumber: true, jobTitle: true, team: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const cumplimientos = await this.compliance.evaluar(activos.map((persona) => persona.id));
    const aptos = activos.filter((persona) => cumplimientos.get(persona.id)?.apto);

    return {
      candidates: aptos.map((persona) => ({ ...persona, cumplimiento: cumplimientos.get(persona.id) })),
      // Se informa cuántos quedaron fuera para que el oficial sepa a quién reclamar.
      excluded: activos.length - aptos.length,
    };
  }

  async jobPositions() {
    return this.prisma.jobPosition.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, canLead: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Abre el permiso: valida la cuadrilla, guarda una firma por integrante y
   * deja la jornada en curso hasta que alguien registre su finalización.
   */
  async submit(formCode: string, dto: SubmitFormDto, request: AuthenticatedRequest) {
    const oficialId = this.collaboratorId(request);
    const charla = await this.validateSafetyTalk(dto.safetyTalkToken, oficialId);
    await this.expireStalePermits();
    if (await this.jornadaAbierta(oficialId)) {
      throw new ConflictException('Ya tienes un permiso pendiente o una jornada sin cerrar.');
    }

    const form = await this.prisma.form.findUnique({ where: { code: formCode }, include: { currentVersion: true } });
    if (!form?.currentVersion || form.status !== 'PUBLISHED' || !form.currentVersion.active) {
      throw new NotFoundException('No hay un formulario vigente.');
    }
    this.validateAnswers(form.currentVersion.schemaJson, dto.answers);

    const integrantes = this.normalizarCuadrilla(dto.members, oficialId);
    const integrantesIds = integrantes.map((persona) => persona.collaboratorId);
    const activos = await this.prisma.collaborator.count({ where: { id: { in: integrantesIds }, status: 'ACTIVE' } });
    if (activos !== integrantesIds.length) {
      throw new ForbiddenException('Todos los integrantes de la cuadrilla deben estar activos.');
    }
    const cumplimientos = await this.compliance.evaluar(integrantesIds);
    const incumplen = integrantes
      .map((persona) => cumplimientos.get(persona.collaboratorId))
      .filter((cumplimiento): cumplimiento is Cumplimiento => Boolean(cumplimiento) && !cumplimiento!.apto);
    if (incumplen.length) {
      throw new ForbiddenException(
        `No puedes incluir a ${incumplen.length} ${incumplen.length === 1 ? 'integrante' : 'integrantes'} sin los requisitos al día.`,
      );
    }
    await this.validarCargos(integrantes);

    // Las firmas se guardan antes de abrir la transacción: escribir archivos
    // dentro de ella alargaría el bloqueo y dejaría basura si algo falla.
    const guardadas = await this.guardarFirmas(integrantes);

    try {
      const ahora = new Date();
      const submission = await this.prisma.$transaction(async (tx) => {
        // Serializa envíos que compartan integrantes, incluso si tienen oficiales distintos.
        for (const id of [...integrantesIds].sort()) {
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
        }
        const existente = await tx.formSubmission.findFirst({
          where: {
            status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
            members: { some: { collaboratorId: { in: integrantesIds } } },
          },
          select: { id: true },
        });
        if (existente)
          throw new ConflictException('Un integrante ya tiene un permiso pendiente o una jornada abierta.');
        const created = await tx.formSubmission.create({
          data: {
            collaboratorId: oficialId,
            formVersionId: form.currentVersion!.id,
            status: 'PENDING_APPROVAL',
            answersJson: this.completarAutomaticos(form.currentVersion!.schemaJson, dto.answers, {
              momento: ahora,
              cumplimiento: cumplimientos.get(oficialId),
            }) as Prisma.InputJsonValue,
            safetyTalkConfirmed: true,
            safetyTalkConfirmedAt: ahora,
            safetyTalkChallengeId: charla.jti,
            safetyTalkVideo: charla.videoId,
            safetyTalkVideoSha256: charla.videoSha256,
            arlSnapshotJson: (cumplimientos.get(oficialId)?.arl ?? {}) as Prisma.InputJsonValue,
            submittedAt: ahora,
            workDate: businessDate(ahora),
          },
        });

        for (const firma of guardadas) {
          const member = await tx.submissionMember.create({
            data: {
              submissionId: created.id,
              collaboratorId: firma.collaboratorId,
              jobPositionId: firma.jobPositionId,
              isLead: firma.collaboratorId === oficialId,
              complianceJson: (cumplimientos.get(firma.collaboratorId) ?? {}) as Prisma.InputJsonValue,
            },
          });
          const file = await tx.fileObject.create({
            data: {
              storageProvider: firma.storageProvider,
              bucket: firma.bucket,
              objectKey: firma.objectKey.replace(/\\/g, '/'),
              originalName: `firma-${firma.collaboratorId}.png`,
              mimeType: 'image/png',
              sizeBytes: firma.sizeBytes,
              sha256: firma.sha256,
              createdById: null,
            },
          });
          await tx.signature.create({
            data: {
              submissionId: created.id,
              memberId: member.id,
              fileId: file.id,
              sha256: firma.sha256,
              ip: request.ip,
              userAgent: request.header('user-agent'),
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            actorCollaboratorId: oficialId,
            action: 'SUBMIT_FORM',
            entityType: 'FORM_SUBMISSION',
            entityId: created.id,
            afterJson: {
              formCode: form.code,
              formVersion: form.currentVersion!.versionNumber,
              status: 'PENDING_APPROVAL',
              crewSize: guardadas.length,
              safetyTalkVideo: charla.videoId,
              safetyTalkVideoSha256: charla.videoSha256,
            },
            ip: request.ip,
            userAgent: request.header('user-agent'),
            correlationId: request.correlationId ?? 'unknown',
          },
        });
        return created;
      });

      return {
        id: submission.id,
        status: submission.status,
        submittedAt: submission.submittedAt,
        startedAt: submission.startedAt,
        crewSize: guardadas.length,
      };
    } catch (error) {
      await Promise.all(guardadas.map((firma) => this.storage.deleteObject(firma.objectKey).catch(() => undefined)));
      throw error;
    }
  }

  /** El integrante confirma el inicio real una vez autorizado el permiso. */
  async startWorkday(submissionId: string, request: AuthenticatedRequest) {
    const collaboratorId = this.collaboratorId(request);
    await this.expireStalePermits();
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: { members: { select: { collaboratorId: true } }, formVersion: { select: { schemaJson: true } } },
    });
    if (!submission) throw new NotFoundException('Permiso no encontrado.');
    if (!submission.members.some((member) => member.collaboratorId === collaboratorId)) {
      throw new ForbiddenException('Solo un integrante de la cuadrilla puede iniciar esta jornada.');
    }
    if (submission.status !== 'APPROVED') throw new ConflictException('El permiso debe estar autorizado.');
    if (submission.startedAt) throw new ConflictException('La jornada ya fue iniciada.');

    const ahora = new Date();
    if (!submission.workDate || submission.workDate.getTime() !== businessDate(ahora).getTime()) {
      throw new ConflictException('El permiso solo puede iniciarse en su fecha de trabajo.');
    }
    const ids = submission.members.map((member) => member.collaboratorId);
    const activos = await this.prisma.collaborator.count({ where: { id: { in: ids }, status: 'ACTIVE' } });
    const vigencias = await this.compliance.evaluar(ids, ahora);
    if (activos !== ids.length || ids.some((id) => !vigencias.get(id)?.apto)) {
      throw new ForbiddenException('La cuadrilla debe estar activa y con los requisitos vigentes al iniciar.');
    }
    return this.prisma.$transaction(async (tx) => {
      const cambiadas = await tx.formSubmission.updateMany({
        where: { id: submissionId, status: 'APPROVED', startedAt: null },
        data: {
          startedAt: ahora,
          answersJson: this.completarAutomaticos(submission.formVersion.schemaJson, submission.answersJson as object, {
            momento: ahora,
            solo: ['startedAt'],
          }) as Prisma.InputJsonValue,
        },
      });
      if (cambiadas.count !== 1) throw new ConflictException('La jornada ya fue iniciada por otra operación.');
      await tx.auditEvent.create({
        data: {
          actorCollaboratorId: collaboratorId,
          action: 'START_WORKDAY',
          entityType: 'FORM_SUBMISSION',
          entityId: submissionId,
          afterJson: { startedAt: ahora.toISOString() },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return { id: submissionId, status: 'APPROVED', startedAt: ahora };
    });
  }

  /**
   * Cierra la jornada. Solo entonces el permiso está completo: hasta aquí no
   * existe hora de finalización y el documento final no tendría sentido.
   */
  async closeWorkday(submissionId: string, dto: CloseWorkdayDto, request: AuthenticatedRequest) {
    const collaboratorId = this.collaboratorId(request);
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: {
        members: { select: { collaboratorId: true } },
        approval: { select: { decidedById: true } },
        formVersion: { select: { schemaJson: true } },
      },
    });
    if (!submission) throw new NotFoundException('Permiso no encontrado.');
    if (!submission.members.some((member) => member.collaboratorId === collaboratorId)) {
      throw new ForbiddenException('Solo un integrante de la cuadrilla puede cerrar esta jornada.');
    }
    if (submission.status === 'CLOSED') throw new ConflictException('Esta jornada ya fue cerrada.');
    if (submission.status !== 'APPROVED') {
      throw new ConflictException('Solo se cierra una jornada autorizada por Coordinación.');
    }
    if (!submission.startedAt) throw new ConflictException('Primero registra el inicio de la jornada.');

    const ahora = new Date();
    const cerrada = await this.prisma.$transaction(async (tx) => {
      const cambiadas = await tx.formSubmission.updateMany({
        where: { id: submissionId, status: 'APPROVED', startedAt: { not: null } },
        data: {
          status: 'CLOSED',
          closedAt: ahora,
          closedById: collaboratorId,
          // La hora de finalización solo existe ahora: se escribe en la
          // respuesta para que el documento final la muestre.
          answersJson: this.completarAutomaticos(submission.formVersion.schemaJson, submission.answersJson as object, {
            momento: submission.startedAt ?? ahora,
            cierre: ahora,
            solo: ['closedAt'],
          }) as Prisma.InputJsonValue,
        },
      });
      if (cambiadas.count !== 1) throw new ConflictException('La jornada fue cerrada por otra operación.');
      await tx.auditEvent.create({
        data: {
          actorCollaboratorId: collaboratorId,
          action: 'CLOSE_WORKDAY',
          entityType: 'FORM_SUBMISSION',
          entityId: submissionId,
          afterJson: { status: 'CLOSED', closedAt: ahora.toISOString() },
          reason: dto.notes?.trim() || undefined,
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return tx.formSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    });

    // Ahora sí el permiso está completo: con la jornada cerrada, el documento
    // final incluye horas reales de inicio y fin. Si falla, el cierre se
    // mantiene y el PDF queda pendiente de regenerar.
    let pdfFileId: string | null = null;
    try {
      pdfFileId = await this.pdf.generateFinalPdf(submissionId, submission.approval!.decidedById);
    } catch (error) {
      this.logger.error(`No fue posible generar el PDF de la jornada ${submissionId}`, error as Error);
    }

    return {
      id: cerrada.id,
      status: cerrada.status,
      startedAt: cerrada.startedAt,
      closedAt: cerrada.closedAt,
      pdfFileId,
    };
  }

  /** Lo último que hizo el colaborador, sea como oficial o como integrante. */
  async latest(request: AuthenticatedRequest) {
    const collaboratorId = this.collaboratorId(request);
    return this.prisma.formSubmission.findFirst({
      where: { members: { some: { collaboratorId } } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        workDate: true,
        startedAt: true,
        closedAt: true,
        collaboratorId: true,
        approval: { select: { decision: true, decidedAt: true, reason: true } },
        members: {
          select: {
            isLead: true,
            collaborator: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
  }

  /** Libera permisos que nunca comenzaron y conserva una traza del vencimiento. */
  async expireStalePermits(): Promise<void> {
    const hoy = businessDate(new Date());
    const stale = await this.prisma.formSubmission.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] }, startedAt: null, workDate: { lt: hoy } },
      select: { id: true, status: true },
    });
    if (!stale.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const item of stale) {
        const changed = await tx.formSubmission.updateMany({
          where: { id: item.id, status: item.status, startedAt: null, workDate: { lt: hoy } },
          data: { status: 'EXPIRED' },
        });
        if (changed.count !== 1) continue;
        await tx.auditEvent.create({
          data: {
            action: 'EXPIRE_UNUSED_PERMIT',
            entityType: 'FORM_SUBMISSION',
            entityId: item.id,
            beforeJson: { status: item.status },
            afterJson: { status: 'EXPIRED' },
            correlationId: `expiry-${item.id}`,
          },
        });
      }
    });
  }

  // ── Interno ──────────────────────────────────────────────────────────
  /** Permiso que impide abrir otro, pendiente o autorizado. */
  private async jornadaAbierta(collaboratorId: string) {
    return this.prisma.formSubmission.findFirst({
      where: { status: { in: ['PENDING_APPROVAL', 'APPROVED'] }, members: { some: { collaboratorId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, workDate: true, startedAt: true },
    });
  }

  /** El oficial siempre integra su cuadrilla, aunque no se haya incluido. */
  private normalizarCuadrilla(members: CrewMemberDto[], oficialId: string): CrewMemberDto[] {
    const vistos = new Set<string>();
    const unicos = members.filter((persona) => {
      if (vistos.has(persona.collaboratorId)) return false;
      vistos.add(persona.collaboratorId);
      return true;
    });
    if (!unicos.some((persona) => persona.collaboratorId === oficialId)) {
      throw new BadRequestException('El oficial que diligencia debe firmar como integrante de la cuadrilla.');
    }
    return unicos;
  }

  private async validarCargos(members: CrewMemberDto[]): Promise<void> {
    const ids = [...new Set(members.map((persona) => persona.jobPositionId).filter(Boolean))] as string[];
    if (!ids.length) return;
    const existentes = await this.prisma.jobPosition.count({ where: { id: { in: ids }, active: true } });
    if (existentes !== ids.length) throw new BadRequestException('Uno o más cargos no existen o están inactivos.');
  }

  private async guardarFirmas(members: CrewMemberDto[]): Promise<FirmaGuardada[]> {
    const guardadas: FirmaGuardada[] = [];
    try {
      for (const persona of members) {
        const contenido = this.signatureBuffer(persona.signatureDataUrl);
        const stored = await this.storage.putObject({
          objectKey: `signatures/${randomUUID()}.png`,
          body: contenido,
          mimeType: 'image/png',
        });
        guardadas.push({
          collaboratorId: persona.collaboratorId,
          jobPositionId: persona.jobPositionId,
          objectKey: stored.objectKey,
          storageProvider: stored.storageProvider,
          bucket: stored.bucket,
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
        });
      }
      return guardadas;
    } catch (error) {
      // Una firma inválida a mitad de lista no debe dejar archivos huérfanos.
      await Promise.all(guardadas.map((firma) => this.storage.deleteObject(firma.objectKey).catch(() => undefined)));
      throw error;
    }
  }

  /**
   * Completa los campos que el sistema resuelve por su cuenta: la fecha y las
   * horas de la jornada, y el resultado de verificar los requisitos. No se le
   * piden al colaborador porque no son suyos: son hechos que el sistema conoce.
   */
  private completarAutomaticos(
    schema: Prisma.JsonValue,
    answers: object,
    contexto: { momento: Date; cumplimiento?: Cumplimiento; cierre?: Date; solo?: Origen[] },
  ): Record<string, unknown> {
    const campos = (schema as { fields?: Field[] }).fields ?? [];
    const valores: Record<string, unknown> = { ...(answers as Record<string, unknown>) };
    const hora = (fecha: Date) =>
      fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    const dia = businessDay;

    for (const campo of campos) {
      if (campo.type !== 'auto' || typeof campo.id !== 'string') continue;
      const origen = campo.source as Origen;
      // Al cerrar solo se toca la hora final: lo verificado al abrir el permiso
      // es evidencia de ese momento y no debe recalcularse después.
      if (contexto.solo && !contexto.solo.includes(origen)) continue;
      switch (origen) {
        case 'workDate':
          valores[campo.id] = dia(contexto.momento);
          break;
        case 'startedAt':
          valores[campo.id] = contexto.solo ? hora(contexto.momento) : 'Pendiente de inicio';
          break;
        case 'closedAt':
          valores[campo.id] = contexto.cierre ? hora(contexto.cierre) : 'Jornada en curso';
          break;
        case 'heightCertificate':
          valores[campo.id] = this.textoRequisito(contexto.cumplimiento?.alturas.estado);
          break;
        case 'socialSecurity':
          valores[campo.id] = this.textoRequisito(contexto.cumplimiento?.seguridadSocial.estado);
          break;
      }
    }
    return valores;
  }

  private textoRequisito(estado?: string): string {
    if (estado === 'VIGENTE') return 'Vigente y verificado';
    if (estado === 'PROXIMA_A_VENCER') return 'Vigente, próximo a vencer';
    return 'No vigente';
  }

  private collaboratorId(request: AuthenticatedRequest): string {
    if (request.principal?.kind !== 'COLLABORATOR')
      throw new ForbiddenException('Esta operación solo está disponible para colaboradores.');
    return request.principal.collaboratorId;
  }

  private signatureBuffer(dataUrl: string): Buffer {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new BadRequestException('La firma debe ser una imagen PNG válida.');
    const content = Buffer.from(match[1], 'base64');
    if (content.length < 100 || content.length > 1_000_000 || content[0] !== 0x89 || content[1] !== 0x50)
      throw new BadRequestException('El archivo de firma no es válido o excede el tamaño permitido.');
    return content;
  }

  private validateAnswers(schema: Prisma.JsonValue, answers: object): void {
    const fields = (schema as { fields?: Field[] }).fields;
    if (!Array.isArray(fields)) throw new BadRequestException('El formulario publicado tiene un esquema inválido.');
    const source = answers as Record<string, unknown>;
    for (const field of fields) {
      if (typeof field.id !== 'string') continue;
      // Los campos automáticos los completa el servidor tras validar; exigirlos
      // aquí rechazaría todo envío legítimo.
      if (field.type === 'auto') continue;
      // Esta selección solo existe cuando el trabajador respondió que sí hay
      // tareas adicionales de alto riesgo. El cliente oculta y limpia el campo
      // al responder "No", por lo que no puede exigirse en ese caso.
      if (field.id === 'otras_tar' && source.otras_tar_involucradas !== 'SI') continue;
      const value = source[field.id];
      if (
        field.required &&
        (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length))
      )
        throw new BadRequestException(`El campo ${field.id} es obligatorio.`);
      if (value === undefined || value === null || value === '') continue;
      if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.includes(value as never)))
        throw new BadRequestException(`Opción no válida en ${field.id}.`);
      if (
        field.type === 'multi_select' &&
        (!Array.isArray(value) ||
          !Array.isArray(field.options) ||
          value.some((item) => !(field.options as unknown[]).includes(item)))
      )
        throw new BadRequestException(`Opciones no válidas en ${field.id}.`);
      if (field.type === 'yes_no' && value !== 'SI' && value !== 'NO')
        throw new BadRequestException(`Respuesta no válida en ${field.id}.`);
      if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
        throw new BadRequestException(`Número no válido en ${field.id}.`);
    }
  }
}
