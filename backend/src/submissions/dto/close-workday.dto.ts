import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_CREW_SIZE } from './submit-form.dto';

/** Firma de término de un integrante, capturada al cerrar la jornada. */
export class ClosingSignatureDto {
  @IsUUID() collaboratorId!: string;
  @IsString() @MaxLength(1_500_000) signatureDataUrl!: string;
}

export class CloseWorkdayDto {
  /** Novedad de la jornada, si la hubo. Queda en el PDF y en la auditoría. */
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /** Campos que el formato pide diligenciar una vez terminada la tarea. */
  @IsOptional() @IsObject() answers?: object;

  /** Firmas de término de toda la cuadrilla, en los formatos que las exigen. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CREW_SIZE)
  @ValidateNested({ each: true })
  @Type(() => ClosingSignatureDto)
  signatures?: ClosingSignatureDto[];
}
