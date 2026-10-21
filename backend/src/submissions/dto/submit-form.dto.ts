import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Filas de integrantes (con su firma) del formato oficial HSE-FO-016 v00. Un
 * permiso con más personas no cabría en el documento final (TEC-008).
 */
export const MAX_CREW_SIZE = 5;

/** Un integrante de la cuadrilla con su firma manuscrita. */
export class CrewMemberDto {
  @IsUUID() collaboratorId!: string;
  @IsUUID() jobPositionId!: string;
  @IsString() @MaxLength(1_500_000) signatureDataUrl!: string;
}

export class SubmitFormDto {
  @IsObject() answers!: object;
  @IsBoolean() @Equals(true) safetyTalkConfirmed!: boolean;
  @IsString() @MaxLength(2048) safetyTalkToken!: string;

  /**
   * La cuadrilla completa, incluido el oficial que diligencia. Cada integrante
   * firma la suya: el permiso ampara a quien está en esta lista y a nadie más.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CREW_SIZE, {
    message: `El formato HSE-FO-016 admite hasta ${MAX_CREW_SIZE} integrantes por permiso.`,
  })
  @ValidateNested({ each: true })
  @Type(() => CrewMemberDto)
  members!: CrewMemberDto[];
}
