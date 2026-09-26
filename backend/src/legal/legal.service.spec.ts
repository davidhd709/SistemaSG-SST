import { NotFoundException } from '@nestjs/common';
import { LegalService } from './legal.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LegalService', () => {
  let service: LegalService;
  let prisma: {
    collaborator: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
    formSubmission: {
      findMany: jest.Mock;
    };
  };

  const mockDate = new Date('2026-08-25T10:00:00Z');
  const mockDateEarlier = new Date('2026-08-24T10:00:00Z');
  const mockDateOldest = new Date('2026-08-20T10:00:00Z');

  beforeEach(() => {
    prisma = {
      collaborator: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      formSubmission: {
        findMany: jest.fn(),
      },
    };

    service = new LegalService(prisma as unknown as PrismaService);
  });

  describe('search', () => {
    it('debe buscar colaboradores y combinar permisos como líder y como cuadrilla sin duplicados', async () => {
      const colabId = 'collab-1';

      prisma.collaborator.findMany.mockResolvedValue([
        {
          id: colabId,
          documentNumber: '1098765432',
          firstName: 'Carlos',
          lastName: 'Mendoza',
          pinHash: 'secret-hash',
          failedLoginAttempts: 0,
          lockedUntil: null,
          arlAffiliations: [{ providerName: 'Sura', endDate: new Date('2026-12-31') }],
          submissions: [
            {
              id: 'sub-lead-1',
              status: 'APPROVED',
              submittedAt: mockDateEarlier,
              createdAt: mockDateEarlier,
              formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
            },
            {
              id: 'sub-shared',
              status: 'CLOSED',
              submittedAt: mockDateOldest,
              createdAt: mockDateOldest,
              formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
            },
          ],
          crewMemberships: [
            {
              submission: {
                id: 'sub-crew-1',
                status: 'PENDING_APPROVAL',
                submittedAt: mockDate,
                createdAt: mockDate,
                formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
              },
            },
            {
              submission: {
                id: 'sub-shared',
                status: 'CLOSED',
                submittedAt: mockDateOldest,
                createdAt: mockDateOldest,
                formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
              },
            },
          ],
        },
      ]);

      const result = await service.search('Carlos');

      expect(result).toHaveLength(1);
      const item = result[0];
      expect(item.id).toBe(colabId);
      expect((item as unknown as { pinHash?: string }).pinHash).toBeUndefined();
      expect((item as unknown as { failedLoginAttempts?: number }).failedLoginAttempts).toBeUndefined();

      expect(item.submissions).toHaveLength(3);
      expect(item.submissions[0].id).toBe('sub-crew-1');
      expect(item.submissions[1].id).toBe('sub-lead-1');
      expect(item.submissions[2].id).toBe('sub-shared');
    });

    it('debe devolver permisos aunque el colaborador nunca haya sido líder', async () => {
      const colabId = 'aux-1';

      prisma.collaborator.findMany.mockResolvedValue([
        {
          id: colabId,
          documentNumber: '9876543210',
          firstName: 'Juan',
          lastName: 'Pérez',
          pinHash: 'hash',
          failedLoginAttempts: 0,
          lockedUntil: null,
          arlAffiliations: [],
          submissions: [],
          crewMemberships: [
            {
              submission: {
                id: 'sub-crew-only',
                status: 'APPROVED',
                submittedAt: mockDate,
                createdAt: mockDate,
                formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
              },
            },
          ],
        },
      ]);

      const result = await service.search('Juan');
      expect(result[0].submissions).toHaveLength(1);
      expect(result[0].submissions[0].id).toBe('sub-crew-only');
    });
  });

  describe('history (AUD-002)', () => {
    const colabId = 'collab-target-id';

    it('debe lanzar NotFoundException si el colaborador no existe', async () => {
      prisma.collaborator.findUnique.mockResolvedValue(null);

      await expect(service.history('non-existent')).rejects.toThrow(NotFoundException);
    });

    it('debe consultar formSubmission.findMany con la cláusula OR que incluye líder y miembros', async () => {
      prisma.collaborator.findUnique.mockResolvedValue({
        id: colabId,
        documentNumber: '12345678',
        firstName: 'Pedro',
        lastName: 'Gómez',
        pinHash: 'secret',
        failedLoginAttempts: 0,
        lockedUntil: null,
        arlAffiliations: [],
      });

      prisma.formSubmission.findMany.mockResolvedValue([]);

      const result = await service.history(colabId);

      expect(prisma.formSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { collaboratorId: colabId },
              { members: { some: { collaboratorId: colabId } } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        }),
      );

      expect(result.id).toBe(colabId);
      expect(result.submissions).toEqual([]);
      expect((result as unknown as { pinHash?: string }).pinHash).toBeUndefined();
    });

    it('debe incluir permisos donde el colaborador fue SOLO miembro de cuadrilla (Regresión AUD-002)', async () => {
      prisma.collaborator.findUnique.mockResolvedValue({
        id: colabId,
        documentNumber: '12345678',
        firstName: 'Pedro',
        lastName: 'Gómez',
        pinHash: 'secret',
        failedLoginAttempts: 0,
        lockedUntil: null,
        arlAffiliations: [],
      });

      const memberSignature = {
        id: 'sig-member-1',
        sha256: 'sha256-member-signature',
        signedAt: mockDate,
        file: { id: 'file-sig-1', sha256: 'sha256-member-signature' },
      };

      prisma.formSubmission.findMany.mockResolvedValue([
        {
          id: 'sub-crew-1',
          collaboratorId: 'oficial-lead-id',
          status: 'APPROVED',
          submittedAt: mockDate,
          createdAt: mockDate,
          formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
          members: [
            {
              collaborator: { id: 'oficial-lead-id', firstName: 'Líder', lastName: 'Oficial', documentNumber: '111' },
              isLead: true,
              signature: { id: 'sig-lead', sha256: 'lead-sha', signedAt: mockDate, file: { id: 'file-lead', sha256: 'lead-sha' } },
            },
            {
              collaborator: { id: colabId, firstName: 'Pedro', lastName: 'Gómez', documentNumber: '12345678' },
              isLead: false,
              signature: memberSignature,
            },
          ],
          signatures: [],
          approval: null,
          finalPdfFile: null,
        },
      ]);

      const result = await service.history(colabId);

      expect(result.submissions).toHaveLength(1);
      const envio = result.submissions[0];
      expect(envio.id).toBe('sub-crew-1');
      expect(envio.status).toBe('APPROVED');
      expect(envio.signature).toEqual({
        id: 'sig-member-1',
        sha256: 'sha256-member-signature',
        signedAt: mockDate,
        file: { id: 'file-sig-1', sha256: 'sha256-member-signature' },
      });
    });

    it('debe retornar exactamente un registro (sin duplicar) cuando el colaborador es líder y miembro simultáneamente', async () => {
      prisma.collaborator.findUnique.mockResolvedValue({
        id: colabId,
        documentNumber: '12345678',
        firstName: 'Pedro',
        lastName: 'Gómez',
        pinHash: 'secret',
        arlAffiliations: [],
      });

      const leaderSignature = {
        id: 'sig-lead-1',
        sha256: 'sha256-leader',
        signedAt: mockDate,
        file: { id: 'file-lead-1', sha256: 'sha256-leader' },
      };

      prisma.formSubmission.findMany.mockResolvedValue([
        {
          id: 'sub-dual-role',
          collaboratorId: colabId,
          status: 'CLOSED',
          submittedAt: mockDate,
          createdAt: mockDate,
          formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
          members: [
            {
              collaborator: { id: colabId, firstName: 'Pedro', lastName: 'Gómez', documentNumber: '12345678' },
              isLead: true,
              signature: leaderSignature,
            },
          ],
          signatures: [],
          approval: null,
          finalPdfFile: null,
        },
      ]);

      const result = await service.history(colabId);

      expect(result.submissions).toHaveLength(1);
      expect(result.submissions[0].id).toBe('sub-dual-role');
      expect(result.submissions[0].signature?.sha256).toBe('sha256-leader');
    });

    it('debe preservar todos los estados de permisos (DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, CLOSED)', async () => {
      prisma.collaborator.findUnique.mockResolvedValue({
        id: colabId,
        documentNumber: '12345678',
        firstName: 'Pedro',
        lastName: 'Gómez',
        arlAffiliations: [],
      });

      const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED'];
      prisma.formSubmission.findMany.mockResolvedValue(
        statuses.map((status, index) => ({
          id: `sub-${status}`,
          collaboratorId: colabId,
          status,
          createdAt: new Date(Date.now() - index * 1000),
          formVersion: { versionNumber: 1, form: { code: 'HSE-FO-016', name: 'Alturas' } },
          members: [],
          signatures: [],
          approval: null,
          finalPdfFile: null,
        })),
      );

      const result = await service.history(colabId);

      expect(result.submissions).toHaveLength(5);
      expect(result.submissions.map((s) => s.status)).toEqual(statuses);
    });
  });
});
