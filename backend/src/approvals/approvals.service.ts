import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../common/request-context';
import { ArlService } from '../arl/arl.service';
import { PrismaService } from '../prisma/prisma.service';
import { DecideSubmissionDto } from './dto/decide-submission.dto';
import { PdfService } from '../pdf/pdf.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly arl: ArlService,
    private readonly pdf: PdfService,
  ) {}
  async dashboard() {
    const groups = await this.prisma.formSubmission.groupBy({ by: ['status'], _count: { _all: true } });
    const counts = Object.fromEntries(groups.map((item) => [item.status, item._count._all]));
    const arl = await this.arl.list('VENCIDA');
    const sinCerrarDeAyer = await this.prisma.formSubmission.count({
      where: { status: 'APPROVED', workDate: { lt: this.hoy() } },
    });
    return {
      pending: counts.PENDING_APPROVAL ?? 0,
      // Autorizado equivale a jornada en curso: la cuadrilla está trabajando.
      inProgress: counts.APPROVED ?? 0,
      approved: (counts.APPROVED ?? 0) + (counts.CLOSED ?? 0),
      closed: counts.CLOSED ?? 0,
      rejected: counts.REJECTED ?? 0,
      blockedByArl: arl.length,
      /** Jornadas de días anteriores que nadie cerró: requieren seguimiento. */
      overdue: sinCerrarDeAyer,
    };
  }

  /**
   * Jornadas todavía abiertas, con las de días pasados primero: son las que
   * Coordinación debe perseguir porque nadie registró su finalización.
   */
  async openWorkdays() {
    const abiertas = await this.prisma.formSubmission.findMany({
      where: { status: 'APPROVED' },
      include: {
        collaborator: { select: { firstName: true, lastName: true, documentNumber: true } },
        members: {
          include: {
            collaborator: { select: { firstName: true, lastName: true } },
            jobPosition: { select: { name: true } },
          },
        },
        formVersion: { include: { form: { select: { code: true, name: true } } } },
      },
      orderBy: { workDate: 'asc' },
      take: 100,
    });
    const hoy = this.hoy();
    return abiertas.map((item) => ({
      id: item.id,
      workDate: item.workDate,
      startedAt: item.startedAt,
      collaborator: item.collaborator,
      crewSize: item.members.length,
      members: item.members.map((member) => ({
        collaborator: member.collaborator,
        jobPosition: member.jobPosition,
      })),
      form: { code: item.formVersion.form.code, name: item.formVersion.form.name },
      overdue: Boolean(item.workDate && item.workDate < hoy),
    }));
  }

  /** Hoy como día calendario UTC, igual que se guarda `workDate`. */
  private hoy(): Date {
    const ahora = new Date();
    return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
  }
  async pending() {
    const submissions = await this.prisma.formSubmission.findMany({
      where: { status: 'PENDING_APPROVAL' },
      include: {
        collaborator: { select: { firstName: true, lastName: true, documentNumber: true } },
        formVersion: { include: { form: { select: { code: true, name: true } } } },
      },
      orderBy: { submittedAt: 'asc' },
    });
    return submissions.map((item) => ({
      id: item.id,
      submittedAt: item.submittedAt,
      collaborator: item.collaborator,
      form: {
        code: item.formVersion.form.code,
        name: item.formVersion.form.name,
        version: item.formVersion.versionNumber,
      },
    }));
  }

  /** Formularios custodiados: cada fila conserva su PDF final cuando ya existe. */
  async custody(month?: string, date?: string) {
    const where: Prisma.FormSubmissionWhereInput = { status: { not: 'DRAFT' } };
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : undefined;
    if (day && !Number.isNaN(day.getTime())) {
      const next = new Date(day);
      next.setUTCDate(next.getUTCDate() + 1);
      where.workDate = { gte: day, lt: next };
    } else if (month && /^\d{4}-\d{2}$/.test(month)) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      where.workDate = { gte: start, lt: end };
    }
    const submissions = await this.prisma.formSubmission.findMany({
      where,
      include: {
        collaborator: { select: { firstName: true, lastName: true, documentNumber: true } },
        members: {
          include: {
            collaborator: { select: { firstName: true, lastName: true, documentNumber: true } },
            jobPosition: { select: { name: true } },
          },
        },
        formVersion: { include: { form: { select: { code: true, name: true } } } },
        finalPdfFile: { select: { id: true, originalName: true } },
      },
      orderBy: [{ workDate: 'desc' }, { submittedAt: 'desc' }],
      take: 500,
    });
    return submissions.map((item) => ({
      id: item.id,
      status: item.status,
      workDate: item.workDate,
      submittedAt: item.submittedAt,
      startedAt: item.startedAt,
      closedAt: item.closedAt,
      collaborator: item.collaborator,
      members: item.members.map((member) => ({ collaborator: member.collaborator, jobPosition: member.jobPosition })),
      form: {
        code: item.formVersion.form.code,
        name: item.formVersion.form.name,
        version: item.formVersion.versionNumber,
      },
      finalPdfFile: item.finalPdfFile,
    }));
  }
  async detail(id: string) {
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id },
      include: {
        collaborator: {
          select: { id: true, firstName: true, lastName: true, documentNumber: true, jobTitle: true, team: true },
        },
        formVersion: { include: { form: { select: { code: true, name: true } } } },
        members: {
          include: {
            collaborator: { select: { id: true, firstName: true, lastName: true, documentNumber: true } },
            jobPosition: { select: { code: true, name: true } },
            signature: { include: { file: { select: { id: true, sha256: true } } } },
          },
        },
        signatures: { include: { file: { select: { id: true, originalName: true, mimeType: true, sha256: true } } } },
        approval: { include: { decidedBy: { select: { id: true, email: true } } } },
      },
    });
    if (!submission) throw new NotFoundException('Envío no encontrado.');
    return submission;
  }
  async decide(id: string, dto: DecideSubmissionDto, request: AuthenticatedRequest) {
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    if (!actorUserId) throw new ForbiddenException();
    if (dto.decision === 'REJECTED' && !dto.reason?.trim())
      throw new ConflictException('El rechazo requiere un motivo.');
    const decision = await this.prisma.$transaction(async (tx) => {
      const submission = await tx.formSubmission.findUnique({ where: { id } });
      if (!submission) throw new NotFoundException('Envío no encontrado.');
      if (submission.status !== 'PENDING_APPROVAL')
        throw new ConflictException('Este envío ya fue decidido y no puede modificarse.');
      const newStatus = dto.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
      const changed = await tx.formSubmission.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: { status: newStatus },
      });
      if (changed.count !== 1) throw new ConflictException('El envío fue actualizado por otra operación.');
      const approval = await tx.approval.create({
        data: {
          submissionId: id,
          decision: dto.decision,
          decidedById: actorUserId,
          reason: dto.decision === 'REJECTED' ? dto.reason!.trim() : dto.observation?.trim(),
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: dto.decision === 'APPROVED' ? 'APPROVE_SUBMISSION' : 'REJECT_SUBMISSION',
          entityType: 'FORM_SUBMISSION',
          entityId: id,
          afterJson: { status: newStatus, decision: dto.decision },
          reason: approval.reason,
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return { submissionId: id, status: newStatus, decision: approval.decision, decidedAt: approval.decidedAt };
    });
    // El PDF final se genera al cerrar la jornada, no aquí: hasta que la
    // cuadrilla no registre su hora de finalización el documento estaría
    // incompleto. Un rechazo sí cierra el proceso y se documenta de una vez.
    if (dto.decision === 'REJECTED') {
      try {
        const pdfFileId = await this.pdf.generateFinalPdf(id, actorUserId);
        return { ...decision, pdfFileId };
      } catch (error) {
        this.logger.error(`No fue posible generar el PDF del envío rechazado ${id}`, error as Error);
        return { ...decision, pdfFileId: null };
      }
    }
    return { ...decision, pdfFileId: null };
  }
}
