import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorageAdapter } from './local-storage.adapter';
import { R2StorageAdapter } from './r2-storage.adapter';
import { StorageService } from './storage.service';
@Global()
@Module({
  controllers: [FilesController],
  providers: [
    LocalStorageAdapter,
    {
      provide: StorageService,
      inject: [ConfigService, LocalStorageAdapter],
      useFactory: (config: ConfigService, local: LocalStorageAdapter) =>
        config.get<string>('R2_BUCKET') &&
        config.get<string>('R2_ENDPOINT') &&
        config.get<string>('R2_ACCESS_KEY_ID') &&
        config.get<string>('R2_SECRET_ACCESS_KEY')
          ? new R2StorageAdapter(config)
          : local,
    },
    FilesService,
  ],
  exports: [StorageService, FilesService],
})
export class FilesModule {}
