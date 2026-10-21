import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { UUID_PARAM_PIPE } from './uuid-param.pipe';

describe('UUID_PARAM_PIPE (AUD-030)', () => {
  const metadata = { type: 'param' as const, metatype: String, data: 'id' };

  it('acepta UUID y rechaza identificadores malformados antes de consultar Prisma', async () => {
    const id = randomUUID();
    await expect(UUID_PARAM_PIPE.transform(id, metadata)).resolves.toBe(id);
    await expect(UUID_PARAM_PIPE.transform('no-es-uuid', metadata)).rejects.toThrow(BadRequestException);
  });
});
