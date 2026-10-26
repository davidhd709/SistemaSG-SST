import { IsObject, IsString, MaxLength, MinLength } from 'class-validator';
export class CreateFormVersionDto {
  @IsObject() schemaJson!: object;
  @IsString() @MinLength(3) @MaxLength(500) changeReason!: string;
}

/** Esquema a revisar contra el formato publicado y su PDF, sin guardarlo. */
export class CheckFormVersionDto {
  @IsObject() schemaJson!: object;
}
