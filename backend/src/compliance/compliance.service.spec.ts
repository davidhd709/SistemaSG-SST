import { ComplianceService } from './compliance.service';

describe('ComplianceService (AUD-013)', () => {
  const now = new Date('2026-10-20T15:00:00.000Z');

  function setup(overrides?: {
    afiliaciones?: unknown[];
    coberturas?: unknown[];
    certificados?: unknown[];
    colaboradores?: unknown[];
  }) {
    const prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue({ valueJson: 5 }) },
      arlAffiliation: {
        findMany: jest.fn().mockResolvedValue(
          overrides?.afiliaciones ?? [
            {
              collaboratorId: 'col-1',
              providerName: 'Sura',
              startDate: new Date('2026-10-01T00:00:00.000Z'),
              endDate: new Date('2026-10-31T00:00:00.000Z'),
            },
          ],
        ),
      },
      payrollMembership: {
        findMany: jest.fn().mockResolvedValue(
          overrides?.coberturas ?? [
            {
              collaboratorId: 'col-1',
              payroll: {
                reference: 'PILA-10',
                periodStart: new Date('2026-10-01T00:00:00.000Z'),
                periodEnd: new Date('2026-10-31T00:00:00.000Z'),
              },
            },
          ],
        ),
      },
      heightCertificate: {
        findMany: jest.fn().mockResolvedValue(
          overrides?.certificados ?? [
            {
              collaboratorId: 'col-1',
              trainingEntity: 'SENA',
              issuedAt: new Date('2026-01-01T00:00:00.000Z'),
              expiresAt: new Date('2026-12-31T00:00:00.000Z'),
            },
          ],
        ),
      },
      collaborator: {
        findMany: jest
          .fn()
          .mockResolvedValue(overrides?.colaboradores ?? [{ id: 'col-1', jobTitle: 'Oficial eléctrico' }]),
      },
    };
    return new ComplianceService(prisma as never);
  }

  it('aprueba al Oficial eléctrico cuando ARL, seguridad social y certificado de alturas cubren hoy', async () => {
    const service = setup();
    const res = await service.evaluarUno('col-1', now);

    expect(res.apto).toBe(true);
    expect(res.faltantes).toEqual([]);
    expect(res.arl.estado).toBe('VIGENTE');
    expect(res.seguridadSocial.estado).toBe('VIGENTE');
    expect(res.alturas.estado).toBe('VIGENTE');
  });

  it('no permite que una planilla futura oculte la falta de cobertura vigente hoy', async () => {
    const service = setup({
      coberturas: [
        {
          collaboratorId: 'col-1',
          payroll: {
            reference: 'PILA-FUTURA',
            periodStart: new Date('2026-11-01T00:00:00.000Z'),
            periodEnd: new Date('2026-11-30T00:00:00.000Z'),
          },
        },
      ],
    });
    const res = await service.evaluarUno('col-1', now);

    expect(res.apto).toBe(false);
    expect(res.seguridadSocial.estado).toBe('VENCIDA');
    expect(res.faltantes).toContain('Seguridad social');
  });

  it('marca NO_APLICA en certificado de alturas para cargos distintos de Oficial eléctrico', async () => {
    const service = setup({
      certificados: [],
      colaboradores: [{ id: 'col-1', jobTitle: 'Auxiliar eléctrico' }],
    });
    const res = await service.evaluarUno('col-1', now);

    expect(res.alturas.estado).toBe('NO_APLICA');
    expect(res.apto).toBe(true);
    expect(res.faltantes).toEqual([]);
  });
});

