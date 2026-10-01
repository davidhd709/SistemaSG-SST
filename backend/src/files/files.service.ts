import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { AuthPrincipal } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from './storage.service';

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async download(id: string, principal?: AuthPrincipal) {
    if (!principal) {
      throw new UnauthorizedException('Se requiere autenticación.');
    }

    const file = await this.prisma.fileObject.findUnique({
      where: { id },
      include: {
        finalPdfFor: {
          select: {
            collaboratorId: true,
            members: { select: { collaboratorId: true } },
          },
        },
        heightCertificates: { select: { collaboratorId: true } },
        arlDocuments: { select: { affiliation: { select: { collaboratorId: true } } } },
        signatures: {
          select: {
            member: { select: { collaboratorId: true } },
            submission: { select: { collaboratorId: true } },
          },
        },
      },
    });

    if (!file) throw new NotFoundException('Archivo no encontrado.');

    if (principal.kind === 'USER') {
      if (!principal.permissions.includes('files:read')) {
        throw new ForbiddenException('No tiene permiso para descargar archivos.');
      }
    } else if (principal.kind === 'COLLABORATOR') {
      const cid = principal.collaboratorId;
      const isPermitted =
        file.finalPdfFor?.collaboratorId === cid ||
        file.finalPdfFor?.members.some((m) => m.collaboratorId === cid) ||
        file.heightCertificates.some((c) => c.collaboratorId === cid) ||
        file.arlDocuments.some((d) => d.affiliation.collaboratorId === cid) ||
        file.signatures.some((s) => s.member?.collaboratorId === cid || s.submission?.collaboratorId === cid);

      if (!isPermitted) {
        throw new ForbiddenException('No tiene permiso para acceder a este archivo.');
      }
    } else {
      throw new ForbiddenException('Tipo de sesión no reconocido.');
    }

    return { file, content: await this.storage.getObject(file.objectKey) };
  }
}
