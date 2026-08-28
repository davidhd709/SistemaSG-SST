import { IsDateString, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateArlAffiliationDto {
  @IsUUID() collaboratorId!: string;
  @IsString() @MaxLength(150) providerName!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}
