import type { Site } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { SITE_CODES } from '../../common/sites';

export class CreateCollaboratorDto {
  @IsString() @MaxLength(20) documentType!: string;
  @IsString() @Matches(/^[0-9A-Za-z-]{5,30}$/) documentNumber!: string;
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(12) pin?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(150) jobTitle?: string;
  @IsOptional() @IsUUID() jobPositionId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) team?: string;
  @IsIn(SITE_CODES) site!: Site;
}
