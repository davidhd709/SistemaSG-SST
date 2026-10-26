import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MAX_CREW_SIZE, SubmitFormDto } from './submit-form.dto';

function dtoWithMembers(count: number): SubmitFormDto {
  return plainToInstance(SubmitFormDto, {
    answers: {},
    safetyTalkConfirmed: true,
    safetyTalkToken: 'token',
    members: Array.from({ length: count }, () => ({
      collaboratorId: randomUUID(),
      jobPositionId: randomUUID(),
      signatureDataUrl: 'data:image/png;base64,AAAA',
    })),
  });
}

describe('SubmitFormDto — tamaño de cuadrilla (TEC-008)', () => {
  it('admite tantos integrantes como filas tiene el formato más grande (ATS HSE-FO-018)', async () => {
    expect(MAX_CREW_SIZE).toBe(12);
    expect(await validate(dtoWithMembers(MAX_CREW_SIZE))).toHaveLength(0);
  });

  it('rechaza una cuadrilla con más integrantes que filas del formato', async () => {
    const errors = await validate(dtoWithMembers(MAX_CREW_SIZE + 1));
    expect(errors.map((error) => error.property)).toEqual(['members']);
    expect(Object.values(errors[0].constraints ?? {})).toEqual([
      'Los formatos admiten hasta 12 integrantes por envío.',
    ]);
  });
});
