import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateJobPositionDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() canLead?: boolean;
  @IsOptional() @IsBoolean() requiresHeightCertificate?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
