import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreatePayrollDto {
  /** Identificador de la planilla ante el operador, por ejemplo el número PILA. */
  @IsString() @MaxLength(100) reference!: string;
  @IsOptional() @IsString() @MaxLength(150) providerName?: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;

  /** Colaboradores que cubre. Al registrarla, todos quedan al día de una vez. */
  @IsArray() @ArrayMinSize(1) @IsUUID('4', { each: true }) collaboratorIds!: string[];
}
