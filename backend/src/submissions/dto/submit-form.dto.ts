import { Equals, IsBoolean, IsObject, IsString, MaxLength } from 'class-validator';
export class SubmitFormDto {
  @IsObject() answers!: object;
  @IsBoolean() @Equals(true) safetyTalkConfirmed!: boolean;
  @IsString() @MaxLength(1_500_000) signatureDataUrl!: string;
}
