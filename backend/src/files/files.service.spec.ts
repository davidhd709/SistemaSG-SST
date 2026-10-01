import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { FilesService } from './files.service';

describe('FilesService.download authorization', () => {
  let service: FilesService;
  let prismaMock: { fileObject: { findUnique: jest.Mock } };
  let storageMock: { getObject: jest.Mock };

  beforeEach(() => {
    prismaMock = {
      fileObject: {
        findUnique: jest.fn(),
      },
    };
    storageMock = {
      getObject: jest.fn().mockResolvedValue(Buffer.from('dummy-pdf-content')),
    };
    service = new FilesService(prismaMock as never, storageMock as never);
  });

  it('throws UnauthorizedException if principal is missing', async () => {
    await expect(service.download('f1', undefined)).rejects.toThrow(UnauthorizedException);
  });

  it('throws NotFoundException if file does not exist', async () => {
    prismaMock.fileObject.findUnique.mockResolvedValue(null);
    await expect(
      service.download('f1', { kind: 'USER', userId: 'u1', roles: ['ADMIN'], permissions: ['files:read'] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows user with files:read to download any file', async () => {
    prismaMock.fileObject.findUnique.mockResolvedValue({
      id: 'f1',
      objectKey: 'permisos/f1.pdf',
    });

    const result = await service.download('f1', {
      kind: 'USER',
      userId: 'u1',
      roles: ['ADMIN'],
      permissions: ['files:read'],
    });

    expect(result.file.id).toBe('f1');
    expect(result.content).toBeDefined();
    expect(storageMock.getObject).toHaveBeenCalledWith('permisos/f1.pdf');
  });

  it('rejects user without files:read permission with 403', async () => {
    prismaMock.fileObject.findUnique.mockResolvedValue({
      id: 'f1',
      objectKey: 'permisos/f1.pdf',
    });

    await expect(
      service.download('f1', {
        kind: 'USER',
        userId: 'u2',
        roles: ['OPERATOR'],
        permissions: ['users:read'],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows collaborator who is leader of the submission to download the PDF', async () => {
    prismaMock.fileObject.findUnique.mockResolvedValue({
      id: 'f1',
      objectKey: 'pdf/sub1.pdf',
      finalPdfFor: {
        collaboratorId: 'c-lead',
        members: [{ collaboratorId: 'c-lead' }, { collaboratorId: 'c-worker' }],
      },
      heightCertificates: [],
      arlDocuments: [],
      signatures: [],
    });

    const result = await service.download('f1', {
      kind: 'COLLABORATOR',
      collaboratorId: 'c-lead',
    });

    expect(result.file.id).toBe('f1');
    expect(storageMock.getObject).toHaveBeenCalledWith('pdf/sub1.pdf');
  });

  it('allows collaborator who is crew member of the submission to download the PDF', async () => {
    prismaMock.fileObject.findUnique.mockResolvedValue({
      id: 'f1',
      objectKey: 'pdf/sub1.pdf',
      finalPdfFor: {
        collaboratorId: 'c-lead',
        members: [{ collaboratorId: 'c-lead' }, { collaboratorId: 'c-worker' }],
      },
      heightCertificates: [],
      arlDocuments: [],
      signatures: [],
    });

    const result = await service.download('f1', {
      kind: 'COLLABORATOR',
      collaboratorId: 'c-worker',
    });

    expect(result.file.id).toBe('f1');
    expect(storageMock.getObject).toHaveBeenCalledWith('pdf/sub1.pdf');
  });

  it('rejects collaborator with 403 if they are not part of the submission crew', async () => {
    prismaMock.fileObject.findUnique.mockResolvedValue({
      id: 'f1',
      objectKey: 'pdf/sub1.pdf',
      finalPdfFor: {
        collaboratorId: 'c-lead',
        members: [{ collaboratorId: 'c-lead' }, { collaboratorId: 'c-worker' }],
      },
      heightCertificates: [],
      arlDocuments: [],
      signatures: [],
    });

    await expect(
      service.download('f1', {
        kind: 'COLLABORATOR',
        collaboratorId: 'c-intruder',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

