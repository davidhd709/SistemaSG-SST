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
            formVersion: { select: { versionNumber: true, form: { select: { code: true, name: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
      take: 100,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return collaborators.map(
      ({ pinHash: _pin, failedLoginAttempts: _attempts, lockedUntil: _locked, ...item }) => item,
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
        submissions: {
          include: {
            formVersion: { include: { form: { select: { code: true, name: true } } } },
            signature: { include: { file: { select: { id: true, sha256: true } } } },
            approval: { include: { decidedBy: { select: { email: true } } } },
            finalPdfFile: { select: { id: true, sha256: true, originalName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!collaborator) throw new NotFoundException('Colaborador no encontrado.');
    const { pinHash: _pin, failedLoginAttempts: _attempts, lockedUntil: _locked, ...safe } = collaborator;
    return safe;
  }
}
