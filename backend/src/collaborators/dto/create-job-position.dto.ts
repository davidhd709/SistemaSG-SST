import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateJobPositionDto {
  /** Identificador estable del cargo; no cambia aunque cambie el nombre. */
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/, { message: 'El código usa mayúsculas, números y guion bajo (2 a 40).' })
  code!: string;

  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsOptional() @IsBoolean() canLead?: boolean;
  @IsOptional() @IsBoolean() requiresHeightCertificate?: boolean;
}
