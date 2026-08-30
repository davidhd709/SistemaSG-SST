import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateHeightCertificateDto {
  @IsUUID() collaboratorId!: string;
  @IsDateString() issuedAt!: string;
  @IsDateString() expiresAt!: string;
  @IsOptional() @IsString() @MaxLength(150) trainingEntity?: string;
}
