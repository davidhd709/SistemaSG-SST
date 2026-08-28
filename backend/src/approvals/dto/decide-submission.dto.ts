import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
export class DecideSubmissionDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @ValidateIf((value: DecideSubmissionDto) => value.decision === 'REJECTED')
  @IsString()
  @MaxLength(1000)
  reason?: string;
  @IsOptional() @IsString() @MaxLength(1000) observation?: string;
}
