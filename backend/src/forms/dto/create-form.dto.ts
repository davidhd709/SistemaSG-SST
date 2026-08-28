import { IsObject, IsString, MaxLength } from 'class-validator';
export class CreateFormDto {
  @IsString() @MaxLength(80) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(1000) description?: string;
  @IsObject() schemaJson!: object;
  @IsString() @MaxLength(500) changeReason!: string;
}
