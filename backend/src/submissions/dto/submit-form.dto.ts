import { Type } from 'class-transformer';
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

/** Un integrante de la cuadrilla con su firma manuscrita. */
export class CrewMemberDto {
  @IsUUID() collaboratorId!: string;
  @IsOptional() @IsUUID() jobPositionId?: string;
  @IsString() @MaxLength(1_500_000) signatureDataUrl!: string;
}

export class SubmitFormDto {
  @IsObject() answers!: object;
  @IsBoolean() @Equals(true) safetyTalkConfirmed!: boolean;

  /**
   * La cuadrilla completa, incluido el oficial que diligencia. Cada integrante
   * firma la suya: el permiso ampara a quien está en esta lista y a nadie más.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CrewMemberDto)
  members!: CrewMemberDto[];
}
