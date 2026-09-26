import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query?: string) {
    const term = query?.trim();
    const collaborators = await this.prisma.collaborator.findMany({
      where: term
        ? {
            OR: [
              { documentNumber: { contains: term, mode: 'insensitive' } },
              { firstName: { contains: term, mode: 'insensitive' } },
              { lastName: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {},
      include: {
        arlAffiliations: { orderBy: { endDate: 'desc' }, take: 1 },
        submissions: {
          select: {
            id: true,
            status: true,
            submittedAt: true,
            createdAt: true,
            formVersion: { select: { versionNumber: true, form: { select: { code: true, name: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        crewMemberships: {
          select: {
            submission: {
              select: {
                id: true,
                status: true,
                submittedAt: true,
                createdAt: true,
                formVersion: { select: { versionNumber: true, form: { select: { code: true, name: true } } } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
      take: 100,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return collaborators.map(
      ({ pinHash: _pin, failedLoginAttempts: _attempts, lockedUntil: _locked, submissions, crewMemberships, ...item }) => {
        const submissionMap = new Map<string, (typeof submissions)[number]>();

        for (const sub of submissions) {
          submissionMap.set(sub.id, sub);
        }
        for (const membership of crewMemberships) {
          if (membership.submission && !submissionMap.has(membership.submission.id)) {
            submissionMap.set(membership.submission.id, membership.submission);
          }
        }

        const sortedSubmissions = Array.from(submissionMap.values())
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 10);

        return {
          ...item,
          submissions: sortedSubmissions,
        };
      },
    );
  }

  async history(collaboratorId: string) {
    const collaborator = await this.prisma.collaborator.findUnique({
      where: { id: collaboratorId },
      include: {
        arlAffiliations: {
          include: {
            documents: {
              include: { file: { select: { id: true, originalName: true, mimeType: true, sha256: true } } },
            },
          },
          orderBy: { endDate: 'desc' },
        },
      },
    });

    if (!collaborator) throw new NotFoundException('Colaborador no encontrado.');

    const submissions = await this.prisma.formSubmission.findMany({
      where: {
        OR: [
          { collaboratorId },
          { members: { some: { collaboratorId } } },
        ],
      },
      include: {
        formVersion: { include: { form: { select: { code: true, name: true } } } },
        members: {
          include: {
            collaborator: { select: { id: true, firstName: true, lastName: true, documentNumber: true } },
            jobPosition: { select: { code: true, name: true } },
            signature: { include: { file: { select: { id: true, sha256: true } } } },
          },
        },
        signatures: { include: { file: { select: { id: true, sha256: true } } } },
        approval: { include: { decidedBy: { select: { email: true } } } },
        finalPdfFile: { select: { id: true, sha256: true, originalName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedSubmissions = submissions.map((sub) => {
      const memberRecord = sub.members.find((m) => m.collaborator?.id === collaboratorId);
      const individualSignature = memberRecord?.signature ?? sub.signatures[0] ?? null;

      return {
        ...sub,
        signature: individualSignature
          ? {
              id: individualSignature.id,
              sha256: individualSignature.sha256,
              signedAt: individualSignature.signedAt,
              file: individualSignature.file,
            }
          : null,
      };
    });

    const { pinHash: _pin, failedLoginAttempts: _attempts, lockedUntil: _locked, ...safe } = collaborator;
    return {
      ...safe,
      submissions: mappedSubmissions,
    };
  }
}
