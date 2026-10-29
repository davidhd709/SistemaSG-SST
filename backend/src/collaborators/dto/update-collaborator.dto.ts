import type { Site } from '@prisma/client';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { SITE_CODES } from '../../common/sites';

export class UpdateCollaboratorDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) lastName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(150) jobTitle?: string;
  @IsOptional() @IsUUID() jobPositionId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) team?: string;
  @IsOptional() @IsIn(SITE_CODES) site?: Site;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(12) pin?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: 'ACTIVE' | 'INACTIVE';
}
