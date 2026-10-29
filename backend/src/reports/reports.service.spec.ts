import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { ReportsService } from './reports.service';

const request = {
  principal: { kind: 'USER', userId: 'coord-1', roles: ['COORDINATOR'], permissions: ['reports:read'] },
  ip: '127.0.0.1',
  header: () => undefined,
  correlationId: 'test',
};

const persona = (firstName: string, documentNumber: string) => ({ firstName, lastName: 'Prueba', documentNumber });

function permiso(overrides: Record<string, unknown>) {
  return {
    id: 'sub-1',
    collaboratorId: 'col-1',
    status: 'CLOSED',
    workDate: new Date('2026-10-20T00:00:00.000Z'),
    submittedAt: new Date('2026-10-20T12:00:00.000Z'),
    startedAt: new Date('2026-10-20T13:00:00.000Z'),
    closedAt: new Date('2026-10-20T21:30:00.000Z'),
    closureNotes: null,
    previousSubmissionId: null,
    finalPdfFileId: 'pdf-1',
    collaborator: persona('Oscar', '100'),
    members: [
      { collaborator: persona('Oscar', '100'), jobPosition: { name: 'Oficial eléctrico' } },
      { collaborator: persona('Ana', '101'), jobPosition: { name: 'Ayudante' } },
    ],
    approval: {
      decision: 'APPROVED',
      decidedAt: new Date('2026-10-20T12:30:00.000Z'),
      reason: null,
      decidedBy: { email: 'coord@empresa.co' },
    },
    closedBy: { firstName: 'Oscar', lastName: 'Prueba' },
    closedByUser: null,
    correction: null,
    site: 'ALCALA',
    formVersion: { versionNumber: 4, form: { code: 'HSE-FO-016', name: 'Permiso de trabajo en altura' } },
    ...overrides,
  };
}

function setup(permisos: unknown[]) {
  const prisma = {
    formSubmission: { findMany: jest.fn().mockResolvedValue(permisos) },
    collaborator: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'col-1',
          firstName: 'Oscar',
          lastName: 'Prueba',
          documentNumber: '100',
          jobTitle: 'Oficial',
          team: null,
          site: 'MONTELIBANO',
        },
      ]),
    },
  };
  const compliance = {
    evaluar: jest.fn().mockResolvedValue(
      new Map([
        [
          'col-1',
          {
            arl: { estado: 'VIGENTE', endDate: '2026-12-31T00:00:00.000Z' },
            seguridadSocial: { estado: 'PROXIMA_A_VENCER', periodEnd: '2026-10-31T00:00:00.000Z' },
            alturas: { estado: 'VIGENTE', expiresAt: '2027-01-01T00:00:00.000Z' },
            apto: true,
            faltantes: [],
          },
        ],
      ]),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return { service: new ReportsService(prisma as never, compliance as never, audit as never), prisma, audit };
}

/** Al leer el archivo se pierden las claves de columna: se ubica por su encabezado. */
function celda(hoja: ExcelJS.Worksheet, fila: number, encabezado: string) {
  let columna = 0;
  hoja.getRow(1).eachCell((celdaEncabezado, numero) => {
    if (celdaEncabezado.value === encabezado) columna = numero;
  });
  if (!columna) throw new Error(`No existe la columna ${encabezado}`);
  return hoja.getRow(fila).getCell(columna).value;
}

async function leer(buffer: Buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer as never);
  return libro;
}

describe('ReportsService', () => {
  it('arma resumen, permisos, rechazos y cumplimiento, y audita la exportación', async () => {
    const { service, prisma, audit } = setup([
      permiso({}),
      permiso({
        id: 'sub-2',
        status: 'REJECTED',
        startedAt: null,
        closedAt: null,
        finalPdfFileId: null,
        closedBy: null,
        approval: {
          decision: 'REJECTED',
          decidedAt: new Date('2026-10-20T13:00:00.000Z'),
          reason: 'Falta el punto de anclaje',
          decidedBy: { email: 'coord@empresa.co' },
        },
        correction: { id: 'sub-3' },
      }),
    ]);
    const { buffer, filename } = await service.submissionsWorkbook('2026-10-01', '2026-10-31', request as never);
    expect(filename).toBe('reporte-permisos-2026-10-01_2026-10-31.xlsx');
    expect(prisma.formSubmission.findMany.mock.calls[0][0].where.workDate).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lte: new Date('2026-10-31T00:00:00.000Z'),
    });

    const libro = await leer(buffer);
    expect(libro.worksheets.map((hoja) => hoja.name)).toEqual(['Resumen', 'Permisos', 'Rechazos', 'Cumplimiento hoy']);

    const resumen = libro.getWorksheet('Resumen')!;
    const valor = (indicador: string) => {
      let encontrado: unknown;
      resumen.eachRow((fila) => {
        if (fila.getCell(1).value === indicador) encontrado = fila.getCell(2).value;
      });
      return encontrado;
    };
    expect(valor('Permisos enviados')).toBe(2);
    expect(valor('Rechazados')).toBe(1);
    expect(valor('Tasa de aprobación')).toBe(0.5);
    expect(valor('Minutos promedio hasta la decisión')).toBe(45);

    const hojaPermisos = libro.getWorksheet('Permisos')!;
    expect(hojaPermisos.rowCount).toBe(3);
    // 13:00 UTC es 08:00 en Colombia: el archivo muestra la hora local.
    const inicio = celda(hojaPermisos, 2, 'Inicio') as Date;
    expect(inicio.toISOString()).toBe('2026-10-20T08:00:00.000Z');
    expect(celda(hojaPermisos, 2, 'Horas de jornada')).toBe(8.5);
    expect(celda(hojaPermisos, 2, 'Cuadrilla')).toBe('Oscar Prueba (Oficial eléctrico), Ana Prueba (Ayudante)');

    const rechazos = libro.getWorksheet('Rechazos')!;
    expect(rechazos.rowCount).toBe(2);
    expect(celda(rechazos, 2, 'Motivo')).toBe('Falta el punto de anclaje');
    expect(celda(rechazos, 2, 'Corregido y reenviado')).toBe('Sí');

    expect(celda(libro.getWorksheet('Cumplimiento hoy')!, 2, 'Seguridad social')).toBe('Próximo a vencer');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EXPORT_SUBMISSIONS_REPORT',
        actorUserId: 'coord-1',
        afterJson: { from: '2026-10-01', to: '2026-10-31', submissions: 2 },
      }),
    );
  });

  it('rechaza fechas imposibles, rangos invertidos y periodos de más de 366 días', async () => {
    const { service, prisma } = setup([]);
    for (const [from, to] of [
      ['2026-02-31', '2026-03-10'],
      ['2026-10-10', '2026-10-01'],
      ['2025-01-01', '2026-01-02'],
    ]) {
      await expect(service.submissionsWorkbook(from, to, request as never)).rejects.toThrow(BadRequestException);
    }
    expect(prisma.formSubmission.findMany).not.toHaveBeenCalled();
    await expect(service.submissionsWorkbook('2024-01-01', '2024-12-31', request as never)).resolves.toBeDefined();
  });
});

describe('Reporte por sede', () => {
  it('filtra permisos y cumplimiento por la sede pedida y la muestra en cada hoja', async () => {
    const { service, prisma } = setup([permiso({})]);
    const { buffer, filename } = await service.submissionsWorkbook(
      '2026-10-01',
      '2026-10-31',
      request as never,
      'MONTELIBANO',
    );
    expect(filename).toBe('reporte-permisos-montelibano-2026-10-01_2026-10-31.xlsx');
    expect(prisma.formSubmission.findMany.mock.calls[0][0].where.site).toBe('MONTELIBANO');
    expect(prisma.collaborator.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE', site: 'MONTELIBANO' });

    const libro = await leer(buffer);
    expect(celda(libro.getWorksheet('Permisos')!, 2, 'Sede')).toBe('Alcalá');
    expect(celda(libro.getWorksheet('Cumplimiento hoy')!, 2, 'Sede')).toBe('Montelíbano');
  });
});
