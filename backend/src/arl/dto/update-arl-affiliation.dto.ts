import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateArlAffiliationDto {
  @IsOptional() @IsString() @MaxLength(150) providerName?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
}
