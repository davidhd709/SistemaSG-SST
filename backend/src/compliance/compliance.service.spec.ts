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
  describe('vencimientos', () => {
    it('avisa lo que vence dentro del plazo y omite lo que tiene cobertura más allá', async () => {
      // Hoy 20/10: ARL y planilla terminan el 31/10 (11 días); el certificado, el 31/12.
      const lista = await setup().vencimientos(['col-1'], 15, now);
      expect(lista).toEqual([
        expect.objectContaining({
          requisito: 'ARL',
          estado: 'POR_VENCER',
          cubiertoHasta: '2026-10-31',
          diasRestantes: 11,
        }),
        expect.objectContaining({ requisito: 'SEGURIDAD_SOCIAL', estado: 'POR_VENCER', diasRestantes: 11 }),
      ]);
      expect(await setup().vencimientos(['col-1'], 5, now)).toEqual([]);
    });

    it('no avisa cuando la renovación ya está cargada y empieza al día siguiente', async () => {
      const service = setup({
        afiliaciones: [
          {
            collaboratorId: 'col-1',
            providerName: 'Sura',
            startDate: new Date('2026-11-01T00:00:00.000Z'),
            endDate: new Date('2027-10-31T00:00:00.000Z'),
          },
          {
            collaboratorId: 'col-1',
            providerName: 'Sura',
            startDate: new Date('2026-10-01T00:00:00.000Z'),
            endDate: new Date('2026-10-31T00:00:00.000Z'),
          },
        ],
      });
      const lista = await service.vencimientos(['col-1'], 15, now);
      expect(lista.map((item) => item.requisito)).toEqual(['SEGURIDAD_SOCIAL']);
    });

    it('marca como vencido lo que hoy no tiene cobertura e informa su última fecha', async () => {
      const service = setup({
        certificados: [
          {
            collaboratorId: 'col-1',
            trainingEntity: 'SENA',
            issuedAt: new Date('2025-01-01T00:00:00.000Z'),
            expiresAt: new Date('2026-10-10T00:00:00.000Z'),
          },
        ],
        coberturas: [],
      });
      const lista = await service.vencimientos(['col-1'], 15, now);
      expect(lista.slice(0, 2)).toEqual([
        expect.objectContaining({
          requisito: 'SEGURIDAD_SOCIAL',
          estado: 'VENCIDO',
          cubiertoHasta: null,
          diasRestantes: null,
        }),
        expect.objectContaining({
          requisito: 'ALTURAS',
          estado: 'VENCIDO',
          cubiertoHasta: '2026-10-10',
          detalle: 'SENA',
        }),
      ]);
    });

    it('no exige certificado de alturas a quien no es Oficial eléctrico', async () => {
      const service = setup({ certificados: [], colaboradores: [{ id: 'col-1', jobTitle: 'Ayudante' }] });
      const lista = await service.vencimientos(['col-1'], 5, now);
      expect(lista.some((item) => item.requisito === 'ALTURAS')).toBe(false);
    });
  });
});
