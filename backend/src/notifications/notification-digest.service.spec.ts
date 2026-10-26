import { NotificationDigestService } from './notification-digest.service';

function setup(vencimientos: unknown[] = [], sinCerrar = 0) {
  const prisma = {
    collaborator: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'oficial', jobPosition: { canLead: true } },
        { id: 'ayudante', jobPosition: { canLead: false } },
      ]),
    },
    formSubmission: { count: jest.fn().mockResolvedValue(sinCerrar) },
  };
  const compliance = { vencimientos: jest.fn().mockResolvedValue(vencimientos) };
  const submissions = { expireStalePermits: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notify: jest.fn().mockResolvedValue(undefined),
    usuariosConPermiso: jest.fn().mockResolvedValue([{ userId: 'coord' }]),
    purgeOlderThan: jest.fn().mockResolvedValue(0),
  };
  const config = { get: jest.fn().mockReturnValue('true') };
  const service = new NotificationDigestService(
    prisma as never,
    compliance as never,
    submissions as never,
    notifications as never,
    config as never,
  );
  return { service, notifications, submissions };
}

// 11:00 UTC = 06:00 en Colombia; 10:00 UTC = 05:00.
const seisAm = new Date('2026-10-22T11:00:00.000Z');
const cincoAm = new Date('2026-10-22T10:00:00.000Z');

describe('NotificationDigestService', () => {
  it('antes de las 6 a. m. de Colombia solo vence permisos y depura la bandeja', async () => {
    const { service, notifications, submissions } = setup([{ collaboratorId: 'oficial', estado: 'VENCIDO' }], 2);
    await service.run(cincoAm);
    expect(submissions.expireStalePermits).toHaveBeenCalled();
    expect(notifications.purgeOlderThan).toHaveBeenCalledWith(90);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('envía el resumen del día a Coordinación con una clave por fecha', async () => {
    const { service, notifications } = setup(
      [
        { collaboratorId: 'ayudante', requisito: 'ARL', estado: 'VENCIDO', diasRestantes: null },
        { collaboratorId: 'ayudante', requisito: 'SEGURIDAD_SOCIAL', estado: 'POR_VENCER', diasRestantes: 12 },
      ],
      1,
    );
    await service.run(seisAm);
    const [, vencimientos] = notifications.notify.mock.calls[0] as [unknown, { body: string; dedupeKey: string }];
    expect(vencimientos.body).toBe('1 requisito vencido y 1 por vencer en los próximos 15 días.');
    expect(vencimientos.dedupeKey).toBe('digest:expirations:2026-10-22');
    const [, jornadas] = notifications.notify.mock.calls[1] as [unknown, { body: string }];
    expect(jornadas.body).toBe('1 jornada de un día anterior sigue abierta.');
    // El ayudante no ingresa a la aplicación: no recibe aviso propio.
    expect(notifications.notify).toHaveBeenCalledTimes(2);
  });

  it('avisa al oficial sus propios vencimientos cercanos con la concordancia correcta', async () => {
    const { service, notifications } = setup([
      { collaboratorId: 'oficial', requisito: 'ALTURAS', estado: 'VENCIDO', diasRestantes: null },
      { collaboratorId: 'oficial', requisito: 'ARL', estado: 'POR_VENCER', diasRestantes: 3 },
      { collaboratorId: 'oficial', requisito: 'SEGURIDAD_SOCIAL', estado: 'POR_VENCER', diasRestantes: 12 },
    ]);
    await service.run(seisAm);
    const propio = notifications.notify.mock.calls.find(([destino]) => destino[0]?.collaboratorId === 'oficial') as [
      unknown,
      { body: string },
    ];
    expect(propio[1].body).toBe(
      'El certificado de alturas está vencido; la ARL vence en 3 días. Avisa a tu coordinadora para no quedar fuera de la cuadrilla.',
    );
  });

  it('un error en la tarea no la deja bloqueada para la siguiente ejecución', async () => {
    const { service, submissions, notifications } = setup();
    submissions.expireStalePermits.mockRejectedValueOnce(new Error('db caída'));
    await service.run(seisAm);
    await service.run(seisAm);
    expect(notifications.purgeOlderThan).toHaveBeenCalledTimes(1);
  });
});
