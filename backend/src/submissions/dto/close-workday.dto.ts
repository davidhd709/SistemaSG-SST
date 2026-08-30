import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CloseWorkdayDto {
  /** Novedad de la jornada, si la hubo. Queda en el PDF y en la auditoría. */
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
