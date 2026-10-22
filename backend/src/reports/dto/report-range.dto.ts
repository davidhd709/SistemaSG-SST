import { Matches } from 'class-validator';

/** Rango de fechas de trabajo, ambos extremos incluidos (AAAA-MM-DD). */
export class ReportRangeDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha inicial debe tener el formato AAAA-MM-DD.' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'La fecha final debe tener el formato AAAA-MM-DD.' })
  to!: string;
}
