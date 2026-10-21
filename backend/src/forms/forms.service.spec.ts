import { BadRequestException } from '@nestjs/common';
import { FormsService } from './forms.service';

describe('FormsService schema policy (AUD-033)', () => {
  const request = {
    principal: { kind: 'USER', userId: 'admin-1' },
    ip: '127.0.0.1',
    header: () => 'agent',
    correlationId: 'test',
  };

  function setup() {
    const tx = {
      form: { create: jest.fn().mockResolvedValue({ id: 'form-1', code: 'TEST' }) },
      formVersion: { create: jest.fn().mockResolvedValue({ id: 'version-1', versionNumber: 1 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      form: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new FormsService(prisma as never), tx };
  }

  const base = { code: 'TEST', name: 'Prueba', changeReason: 'Versión inicial' };

  it('accepts supported automatic fields and persists their source', async () => {
    const { service, tx } = setup();
    const schemaJson = {
      fields: [
        {
          id: 'fecha_trabajo',
          type: 'auto',
          label: 'Fecha',
          required: true,
          order: 1,
          source: 'workDate',
        },
      ],
    };

    await expect(service.create({ ...base, schemaJson }, request as never)).resolves.toBeDefined();
    const [createArgs] = tx.formVersion.create.mock.calls[0] as [{ data: { schemaJson: unknown } }];
    expect(createArgs.data.schemaJson).toEqual(schemaJson);
  });

  it('rejects reserved identifiers on editable fields', async () => {
    const { service, tx } = setup();
    await expect(
      service.create(
        {
          ...base,
          schemaJson: {
            fields: [{ id: 'fecha_trabajo', type: 'text', label: 'Fecha', required: true, order: 1 }],
          },
        },
        request as never,
      ),
    ).rejects.toThrow('El identificador fecha_trabajo está reservado');
    expect(tx.form.create).not.toHaveBeenCalled();
  });

  it('rejects unknown automatic sources and protected identity identifiers', async () => {
    const invalidSource = setup();
    await expect(
      invalidSource.service.create(
        {
          ...base,
          schemaJson: {
            fields: [{ id: 'dato_servidor', type: 'auto', label: 'Dato', required: true, order: 1, source: 'request' }],
          },
        },
        request as never,
      ),
    ).rejects.toThrow(BadRequestException);

    const protectedId = setup();
    await expect(
      protectedId.service.create(
        {
          ...base,
          schemaJson: {
            fields: [{ id: 'nombre', type: 'auto', label: 'Nombre', required: true, order: 1, source: 'workDate' }],
          },
        },
        request as never,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
