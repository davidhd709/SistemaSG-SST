import { Module } from '@nestjs/common';
import { CollaboratorsController } from './collaborators.controller';
import { CollaboratorsService } from './collaborators.service';
import { JobPositionsController } from './job-positions.controller';
import { JobPositionsService } from './job-positions.service';

@Module({
  controllers: [CollaboratorsController, JobPositionsController],
  providers: [CollaboratorsService, JobPositionsService],
})
export class CollaboratorsModule {}
