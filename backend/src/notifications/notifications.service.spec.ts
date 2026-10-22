import { BadRequestException } from '@nestjs/common';
import type { AuthPrincipal } from '../common/request-context';
import { NotificationsService } from './notifications.service';
import { esEndpointPushPermitido } from './push.service';

const usuario: AuthPrincipal = { kind: 'USER', userId: 'user-1', roles: [], permissions: [] };
const colaborador: AuthPrincipal = { kind: 'COLLABORATOR', collaboratorId: 'col-1' };

function setup(pushEnabled = true) {
  const prisma = {
    notification: {
      createManyAndReturn: jest.fn((args: { data: object[] }) => Promise.resolve(args.data)),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    pushSubscription: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'coord-1' }, { id: 'coord-2' }]) },
  };
  const push = {
    enabled: pushEnabled,
    publicKey: pushEnabled ? 'public' : null,
    send: jest.fn().mockResolvedValue('ENVIADO'),
  };
  return { service: new NotificationsService(prisma as never, push as never), prisma, push };
}

describe('NotificationsService', () => {
  it('crea un aviso por destinatario y combina la clave de deduplicación con cada uno', async () => {
    const { service, prisma } = setup(false);
    await service.notify([{ userId: 'u1' }, { collaboratorId: 'c1' }], {
      type: 'DIGEST',
      title: 'T',
      body: 'B',
      dedupeKey: 'digest:2026-10-22',
    });
    const { data, skipDuplicates } = prisma.notification.createManyAndReturn.mock.calls[0][0] as {
      data: { recipientUserId?: string; recipientCollaboratorId?: string; dedupeKey?: string }[];
      skipDuplicates: boolean;
    };
    expect(skipDuplicates).toBe(true);
    expect(data.map((fila) => fila.dedupeKey)).toEqual(['digest:2026-10-22:u:u1', 'digest:2026-10-22:c:c1']);
    expect(data[1]).toMatchObject({ recipientCollaboratorId: 'c1', recipientUserId: undefined });
  });

  it('envía push a los dispositivos de los destinatarios y descarta las suscripciones vencidas', async () => {
    const { service, prisma, push } = setup();
    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: 's1', endpoint: 'https://fcm.googleapis.com/a', p256dh: 'k', auth: 'a', failures: 0 },
      { id: 's2', endpoint: 'https://fcm.googleapis.com/b', p256dh: 'k', auth: 'a', failures: 0 },
    ]);
    push.send.mockResolvedValueOnce('ENVIADO').mockResolvedValueOnce('VENCIDA');
    await service.notify([{ userId: 'u1' }], { type: 'X', title: 'Título', body: 'Cuerpo', link: '/coordinacion' });
    const payload = push.send.mock.calls[0][1] as { notification: { data: unknown } };
    expect(payload.notification.data).toEqual({
      onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '/coordinacion' } },
    });
    expect(prisma.pushSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1' } }));
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 's2' } });
  });

  it('no envía push de nuevo cuando el aviso ya existía', async () => {
    const { service, prisma, push } = setup();
    prisma.notification.createManyAndReturn.mockResolvedValue([]);
    await service.notify([{ userId: 'u1' }], { type: 'X', title: 'T', body: 'B', dedupeKey: 'k' });
    expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('un fallo al registrar el aviso no interrumpe la operación que lo origina', async () => {
    const { service, prisma } = setup();
    prisma.notification.createManyAndReturn.mockRejectedValue(new Error('db caída'));
    await expect(service.notify([{ userId: 'u1' }], { type: 'X', title: 'T', body: 'B' })).resolves.toBeUndefined();
    prisma.user.findMany.mockRejectedValue(new Error('db caída'));
    await expect(
      service.notifyPermission('submissions:review', { type: 'X', title: 'T', body: 'B' }),
    ).resolves.toBeUndefined();
  });

  it('cada persona solo ve y marca sus propios avisos', async () => {
    const { service, prisma } = setup();
    await service.list(colaborador, true, 20);
    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({
      recipientCollaboratorId: 'col-1',
      readAt: null,
    });
    await service.markRead(usuario, 'n1');
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({
      id: 'n1',
      recipientUserId: 'user-1',
      readAt: null,
    });
  });

  it('solo acepta suscripciones de servicios de push conocidos', async () => {
    const { service, prisma } = setup();
    const request = { principal: colaborador, header: () => 'agent' };
    const keys = { p256dh: 'BPk', auth: 'aa' };
    await expect(
      service.subscribe(request as never, { endpoint: 'https://169.254.169.254/latest', keys }),
    ).rejects.toThrow(BadRequestException);
    await service.subscribe(request as never, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys });
    expect(prisma.pushSubscription.upsert.mock.calls[0][0].create).toMatchObject({ collaboratorId: 'col-1' });
  });
});

describe('esEndpointPushPermitido', () => {
  it.each([
    ['https://fcm.googleapis.com/fcm/send/x', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/x', true],
    ['https://wns2-par02p.notify.windows.com/w/?token=x', true],
    ['https://web.push.apple.com/abc', true],
    ['http://fcm.googleapis.com/fcm/send/x', false],
    ['https://fcm.googleapis.com:8443/x', false],
    ['https://fcm.googleapis.com.evil.co/x', false],
    ['https://localhost/x', false],
    ['no es una url', false],
  ])('%s → %s', (endpoint, esperado) => {
    expect(esEndpointPushPermitido(endpoint)).toBe(esperado);
  });
});
