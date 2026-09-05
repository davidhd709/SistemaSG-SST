import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateCollaboratorDto {
  @IsString() @MaxLength(20) documentType!: string;
  @IsString() @Matches(/^[0-9A-Za-z-]{5,30}$/) documentNumber!: string;
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;
  @IsOptional() @IsString() @MinLength(4) @MaxLength(12) pin?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsString() @MaxLength(150) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(100) team?: string;
}
