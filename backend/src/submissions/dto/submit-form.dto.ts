import { Type } from 'class-transformer';
import { MAX_INTEGRANTES_FORMATO } from '../../forms/form-profiles';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Mayor número de filas de integrantes (con su firma) entre los formatos
 * oficiales. El servicio aplica el límite propio de cada formato: un envío
 * con más personas no cabría en el documento final (TEC-008).
 */
export const MAX_CREW_SIZE = MAX_INTEGRANTES_FORMATO;

/** Un integrante de la cuadrilla con su firma manuscrita. */
export class CrewMemberDto {
  @IsUUID() collaboratorId!: string;
  @IsUUID() jobPositionId!: string;
  @IsString() @MaxLength(1_500_000) signatureDataUrl!: string;
}

export class SubmitFormDto {
  @IsObject() answers!: object;
  /** Solo los formatos con charla de seguridad la exigen. */
  @IsOptional() @IsBoolean() @Equals(true) safetyTalkConfirmed?: boolean;
  @IsOptional() @IsString() @MaxLength(2048) safetyTalkToken?: string;

  /**
   * La cuadrilla completa, incluido el oficial que diligencia. Cada integrante
   * firma la suya: el permiso ampara a quien está en esta lista y a nadie más.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CREW_SIZE, {
    message: `Los formatos admiten hasta ${MAX_CREW_SIZE} integrantes por envío.`,
  })
  @ValidateNested({ each: true })
  @Type(() => CrewMemberDto)
  members!: CrewMemberDto[];

  /** Permiso rechazado que este envío corrige, cuando el oficial lo reenvía. */
  @IsOptional() @IsUUID() previousSubmissionId?: string;
}
