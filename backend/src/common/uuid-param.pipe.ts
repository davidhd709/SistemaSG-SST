import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

export const UUID_PARAM_PIPE = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('El identificador de la ruta debe ser un UUID válido.'),
});
