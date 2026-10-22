import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ExpirationsQueryDto {
  /** Plazo de aviso: días hacia adelante en los que se busca un vencimiento. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days = 30;
}
