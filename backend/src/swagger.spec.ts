import { SwaggerModule } from '@nestjs/swagger';
import { setupSwagger } from './swagger';

describe('setupSwagger (AUD-009)', () => {
  it('no crea ni registra documentación de API en producción', () => {
    const createDocument = jest.spyOn(SwaggerModule, 'createDocument');
    const setup = jest.spyOn(SwaggerModule, 'setup');

    setupSwagger({} as never, 'production');

    expect(createDocument).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
    createDocument.mockRestore();
    setup.mockRestore();
  });

  it('mantiene Swagger disponible para desarrollo', () => {
    const createDocument = jest.spyOn(SwaggerModule, 'createDocument').mockReturnValue({} as never);
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation(() => undefined);
    setupSwagger({} as never, 'development');
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(setup.mock.calls[0][0]).toBe('api/docs');
    createDocument.mockRestore();
    setup.mockRestore();
  });
});
