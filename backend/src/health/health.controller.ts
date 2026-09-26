import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { HealthService } from './health.service';
import { Public } from '../auth/auth.decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get()
  @Public()
  @ApiOkResponse({ description: 'Estado del proceso y de PostgreSQL.' })
  check(): Promise<{ status: 'ok'; database: 'up'; timestamp: string }> {
    return this.healthService.check();
  }
}
