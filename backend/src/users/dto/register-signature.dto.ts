import { IsString, MaxLength, MinLength } from 'class-validator';

/** Nombre y firma que Coordinación estampa en los formatos que aprueba. */
export class RegisterSignatureDto {
  @IsString() @MinLength(3) @MaxLength(120) fullName!: string;
  @IsString() @MaxLength(1_500_000) signatureDataUrl!: string;
}
