import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CollaboratorLoginDto {
  @IsString()
  @Matches(/^[0-9A-Za-z-]{5,30}$/)
  documentNumber!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(12)
  pin!: string;
}
