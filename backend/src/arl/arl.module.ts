import { Module } from '@nestjs/common';
import { ArlController } from './arl.controller';
import { ArlService } from './arl.service';
@Module({ controllers: [ArlController], providers: [ArlService], exports: [ArlService] })
export class ArlModule {}
