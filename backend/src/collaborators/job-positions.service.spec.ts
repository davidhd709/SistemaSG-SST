import { ConflictException } from '@nestjs/common';
import { JobPositionsService } from './job-positions.service';

const positionId = '66666666-6666-4666-8666-666666666666';
const request = {
  principal: { kind: 'USER', userId: 'admin-1', roles: ['ADMIN'], permissions: ['job-positions:manage'] },
  ip: '127.0.0.1',
  header: () => undefined,
  correlationId: 'test',
};
const oficial = {
  id: positionId,
  code: 'OFICIAL_ELECTRICO',
  name: 'Oficial eléctrico',
  canLead: true,
  requiresHeightCertificate: true,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function setup() {
  const tx = {
    collaborator: { count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    jobPosition: {
      update: jest.fn((args: { data: object }) => Promise.resolve({ ...oficial, ...args.data })),
      create: jest.fn((args: { data: object }) => Promise.resolve({ ...oficial, id: 'new', ...args.data })),
    },
    refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    jobPosition: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(oficial),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  return { service: new JobPositionsService(prisma as never), prisma, tx };
}

describe('JobPositionsService', () => {
  it('cuenta colaboradores activos y, en cargos que lideran, cuántos no tienen PIN', async () => {
    const { service, prisma } = setup();
    prisma.jobPosition.findMany.mockResolvedValue([
      { ...oficial, collaborators: [{ pinHash: 'hash' }, { pinHash: null }] },
      { ...oficial, id: 'ayudante', canLead: false, collaborators: [{ pinHash: null }] },
    ]);
    const lista = await service.list();
    expect(lista.map(({ activeCollaborators, withoutPin }) => [activeCollaborators, withoutPin])).toEqual([
      [2, 1],
      [1, 0],
    ]);
  });

  it('rechaza nombres o códigos repetidos', async () => {
    const { service, prisma } = setup();
    prisma.jobPosition.findFirst.mockResolvedValueOnce({ id: 'otro' });
    await expect(service.create({ code: 'LINIERO', name: 'oficial ELÉCTRICO' }, request as never)).rejects.toThrow(
      ConflictException,
    );
    prisma.jobPosition.findUnique.mockResolvedValueOnce(oficial);
    await expect(service.create({ code: 'OFICIAL_ELECTRICO', name: 'Liniero' }, request as never)).rejects.toThrow(
      'Ya existe un cargo con ese código.',
    );
  });

  it('al renombrar sincroniza el texto del cargo en sus colaboradores y audita el cambio', async () => {
    const { service, tx } = setup();
    await service.update(positionId, { name: 'Oficial electricista' }, request as never);
    expect(tx.collaborator.updateMany).toHaveBeenCalledWith({
      where: { jobPositionId: positionId },
      data: { jobTitle: 'Oficial electricista' },
    });
    const auditoria = (
      tx.auditEvent.create.mock.calls[0] as [{ data: { beforeJson: { name: string }; afterJson: { name: string } } }]
    )[0].data;
    expect(auditoria.beforeJson.name).toBe('Oficial eléctrico');
    expect(auditoria.afterJson.name).toBe('Oficial electricista');
  });

  it('al quitar el liderazgo revoca las sesiones de los colaboradores de ese cargo', async () => {
    const { service, tx } = setup();
    await service.update(positionId, { canLead: false }, request as never);
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revokedAt: null, collaborator: { jobPositionId: positionId } } }),
    );
    expect(tx.auditEvent.create.mock.calls[0][0].data.afterJson.sesionesRevocadas).toBe(3);
  });

  it('no desactiva un cargo con colaboradores activos asignados', async () => {
    const { service, tx } = setup();
    tx.collaborator.count.mockResolvedValue(4);
    await expect(service.update(positionId, { active: false }, request as never)).rejects.toThrow(
      'Reasigna a 4 colaboradores activos antes de desactivar este cargo.',
    );
    expect(tx.jobPosition.update).not.toHaveBeenCalled();
  });
});
