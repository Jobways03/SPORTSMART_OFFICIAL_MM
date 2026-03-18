import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { RedisService } from '../../bootstrap/cache/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    const checks: Record<string, string> = {};

    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    try {
      await this.redis.getClient().ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');

    return {
      success: healthy,
      status: healthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
