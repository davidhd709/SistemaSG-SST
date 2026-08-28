import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports healthy when PostgreSQL responds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const service = new HealthService(prisma as never);

    const result = await service.check();
    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
  });
});
