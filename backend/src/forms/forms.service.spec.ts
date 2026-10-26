import { BadRequestException } from '@nestjs/common';
import { workAtHeightSchema } from '../../prisma/seed-data/work-at-height';
import { TemplateLoader } from '../pdf/template-loader';
import { TemplateRegistry } from '../pdf/template-registry';
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
    return { service: new FormsService(prisma as never, new TemplateRegistry(), new TemplateLoader()), tx };
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

describe('Editor de formatos: compatibilidad con el PDF oficial HSE-FO-016', () => {
  const request = {
    principal: { kind: 'USER', userId: 'admin-1' },
    ip: '127.0.0.1',
    header: () => 'agent',
    correlationId: 'test',
  };
  type Campo = { id: string; type: string; label: string; options?: string[] } & Record<string, unknown>;
  const vigente = workAtHeightSchema as unknown as { fields: Campo[] };

  function setup() {
    const tx = {
      formVersion: {
        findFirst: jest.fn().mockResolvedValue({ versionNumber: 4 }),
        create: jest.fn((args: { data: object }) => Promise.resolve({ id: 'version-5', ...args.data })),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      form: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'form-1',
          code: 'HSE-FO-016',
          currentVersion: { versionNumber: 4, schemaJson: vigente },
        }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    return { service: new FormsService(prisma as never, new TemplateRegistry(), new TemplateLoader()), tx };
  }

  const conCampos = (fields: Campo[]) => ({ ...vigente, fields });
  // Sus opciones marcan las casillas de sistema de acceso del PDF.
  const campoConOpciones = () => vigente.fields.find((campo) => campo.id === 'sistemas_acceso')!;

  it('acepta el formato vigente sin errores ni advertencias', async () => {
    await expect(setup().service.checkVersion('form-1', vigente)).resolves.toEqual({ errors: [], warnings: [] });
  });

  it('permite cambiar textos de ayuda y la obligatoriedad de un campo impreso', async () => {
    const fields = vigente.fields.map((campo) =>
      campo.id === 'ciudad' ? { ...campo, label: 'Ciudad o municipio', required: false } : campo,
    );
    expect((await setup().service.checkVersion('form-1', conCampos(fields))).errors).toEqual([]);
  });

  it('bloquea retirar un campo que se imprime en el PDF', async () => {
    const { service, tx } = setup();
    const fields = vigente.fields.filter((campo) => campo.id !== 'ciudad');
    const revision = await service.checkVersion('form-1', conCampos(fields));
    expect(revision.errors).toEqual([expect.stringContaining('(ciudad) se imprime en el PDF oficial')]);
    await expect(
      service.createVersion(
        'form-1',
        { schemaJson: conCampos(fields), changeReason: 'Quitar ciudad' },
        request as never,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(tx.formVersion.create).not.toHaveBeenCalled();
  });

  it('bloquea retirar una opción que marca una casilla del PDF', async () => {
    const objetivo = campoConOpciones();
    const fields = vigente.fields.map((campo) =>
      campo.id === objetivo.id ? { ...campo, options: campo.options!.slice(1) } : campo,
    );
    const revision = await setup().service.checkVersion('form-1', conCampos(fields));
    expect(revision.errors).toEqual([expect.stringContaining(`La opción "${objetivo.options![0]}"`)]);
  });

  it('advierte que un campo nuevo no se imprime y guarda el borrador con el siguiente número', async () => {
    const { service, tx } = setup();
    const nuevo = {
      id: 'observaciones_sitio',
      type: 'textarea',
      label: 'Observaciones del sitio',
      required: false,
      order: 999,
    };
    const resultado = await service.createVersion(
      'form-1',
      { schemaJson: conCampos([...vigente.fields, nuevo]), changeReason: 'Agregar observaciones' },
      request as never,
    );
    expect(resultado.versionNumber).toBe(5);
    expect(resultado.warnings).toEqual([expect.stringContaining('"Observaciones del sitio" no aparece en el PDF')]);
    expect(tx.auditEvent.create.mock.calls[0][0].data.action).toBe('CREATE_FORM_VERSION');
  });

  it('rechaza opciones repetidas o vacías', async () => {
    const objetivo = campoConOpciones();
    const fields = vigente.fields.map((campo) =>
      campo.id === objetivo.id ? { ...campo, options: [...campo.options!, campo.options![0]] } : campo,
    );
    await expect(setup().service.checkVersion('form-1', conCampos(fields))).rejects.toThrow(
      'deben ser textos únicos y no vacíos',
    );
  });
});
