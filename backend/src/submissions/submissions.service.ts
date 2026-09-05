import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { ComplianceService, type Cumplimiento } from '../compliance/compliance.service';
import { PdfService } from '../pdf/pdf.service';
import { SubmitFormDto, type CrewMemberDto } from './dto/submit-form.dto';
import { CloseWorkdayDto } from './dto/close-workday.dto';

type Field = { id?: unknown; type?: unknown; required?: unknown; options?: unknown; source?: unknown };

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
  ) {}

  /** Estado del oficial que abre el permiso y su propio cumplimiento. */
  async workflow(request: AuthenticatedRequest) {
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
    if (await this.jornadaAbierta(oficialId)) {
      throw new ConflictException('Tienes una jornada sin cerrar. Ciérrala antes de abrir un permiso nuevo.');
    }

    const form = await this.prisma.form.findUnique({ where: { code: formCode }, include: { currentVersion: true } });
    if (!form?.currentVersion || form.status !== 'PUBLISHED' || !form.currentVersion.active) {
      throw new NotFoundException('No hay un formulario vigente.');
    }
    this.validateAnswers(form.currentVersion.schemaJson, dto.answers);

    const integrantes = this.normalizarCuadrilla(dto.members, oficialId);
    const cumplimientos = await this.compliance.evaluar(integrantes.map((persona) => persona.collaboratorId));
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
            arlSnapshotJson: (cumplimientos.get(oficialId)?.arl ?? {}) as Prisma.InputJsonValue,
            submittedAt: ahora,
            workDate: this.diaCalendario(ahora),
            startedAt: ahora,
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

    const ahora = new Date();
    const cerrada = await this.prisma.$transaction(async (tx) => {
      const cambiadas = await tx.formSubmission.updateMany({
        where: { id: submissionId, status: 'APPROVED' },
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

  // ── Interno ──────────────────────────────────────────────────────────
  /** La jornada que sigue abierta, si la hay: autorizada y sin cerrar. */
  private async jornadaAbierta(collaboratorId: string) {
    return this.prisma.formSubmission.findFirst({
      where: { status: 'APPROVED', members: { some: { collaboratorId } } },
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
    const dia = (fecha: Date) => fecha.toISOString().slice(0, 10);

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
          valores[campo.id] = hora(contexto.momento);
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

  /** El permiso vale para el día en que se diligencia, en días calendario UTC. */
  private diaCalendario(momento: Date): Date {
    return new Date(Date.UTC(momento.getUTCFullYear(), momento.getUTCMonth(), momento.getUTCDate()));
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
