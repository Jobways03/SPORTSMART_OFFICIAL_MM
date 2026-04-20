import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { RedisService } from '../../bootstrap/cache/redis.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Readiness probe for load balancers and k8s-style orchestrators.
   *
   * Critical: the HTTP status must reflect dependency health. An ALB /
   * ingress controller polling `/health` decides up-or-down purely from
   * the status code — the JSON body is for humans. Prior versions of
   * this endpoint returned 200 regardless of the check results, so a
   * node with a broken DB connection happily stayed in rotation and
   * shed the failures onto customers.
   */
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
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
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      success: healthy,
      status: healthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Liveness probe — "is the process alive and able to answer?".
   *
   * Intentionally does not touch the DB or Redis: a temporary
   * dependency blip should trigger a readiness failure (de-route
   * traffic) but NOT a liveness failure (restart the pod), otherwise
   * a downed database takes every API pod into a crash-loop and
   * nothing recovers.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'alive', timestamp: new Date().toISOString() };
  }
}
