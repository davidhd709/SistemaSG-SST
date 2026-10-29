import type { Site } from '@prisma/client';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { SITE_CODES } from '../../common/sites';

/** Rango de fechas de trabajo, ambos extremos incluidos (AAAA-MM-DD). */
export class ReportRangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha inicial debe tener el formato AAAA-MM-DD.' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha final debe tener el formato AAAA-MM-DD.' })
  to!: string;

  /** Sin sede, el reporte incluye las dos. */
  @IsOptional() @IsIn(SITE_CODES) site?: Site;
}
