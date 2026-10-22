import { Type } from 'class-transformer';
import { IsString, IsUrl, Matches, MaxLength, ValidateNested } from 'class-validator';

class PushKeysDto {
  /** Llave pública del navegador (P-256), en base64url. */
  @IsString() @MaxLength(200) @Matches(/^[A-Za-z0-9_-]+=*$/) p256dh!: string;
  @IsString() @MaxLength(100) @Matches(/^[A-Za-z0-9_-]+=*$/) auth!: string;
}

/** Lo que entrega `PushManager.subscribe()` en el navegador. */
export class PushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(1000) endpoint!: string;
  @ValidateNested() @Type(() => PushKeysDto) keys!: PushKeysDto;
}

export class PushUnsubscribeDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(1000) endpoint!: string;
}
