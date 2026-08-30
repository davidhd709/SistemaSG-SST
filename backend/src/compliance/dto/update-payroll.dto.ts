import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdatePayrollDto {
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(150) providerName?: string;
  @IsOptional() @IsDateString() periodStart?: string;
  @IsOptional() @IsDateString() periodEnd?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) collaboratorIds?: string[];
}
