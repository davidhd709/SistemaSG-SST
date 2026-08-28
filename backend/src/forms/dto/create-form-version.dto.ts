import { IsObject, IsString, MaxLength } from 'class-validator';
export class CreateFormVersionDto {
  @IsObject() schemaJson!: object;
  @IsString() @MaxLength(500) changeReason!: string;
}
