import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { RedisService } from '../../bootstrap/cache/redis.service';

/**
 * Two probes:
 *   GET /health     — liveness. 200 always (unless the process is
 *                     wedged, in which case the request doesn't
 *                     return at all). Used by LB liveness probes
 *                     that should NOT shed the pod for a transient
 *                     DB blip.
 *   GET /readiness  — readiness. Hits Prisma + Redis. 200 when both
 *                     are reachable, 503 otherwise. Used by LB
 *                     readiness probes to route traffic only to
 *                     healthy replicas.
 *
 * Both routes are unauthenticated — the LB doesn't carry an API key,
 * and the bodies leak no operational secrets (just status booleans
 * and the app version).
 */
@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe — process is up.' })
  @ApiResponse({ status: 200, description: 'Service is alive.' })
  liveness() {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '0.0.1',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readiness')
  @ApiOperation({
    summary: 'Readiness probe — DB and Redis are reachable.',
  })
  @ApiResponse({ status: 200, description: 'All dependencies reachable.' })
  @ApiResponse({ status: 503, description: 'One or more dependencies are degraded.' })
  async readiness(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, 'ok' | 'error'> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
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

    const allOk = Object.values(checks).every((v) => v === 'ok');
    res.status(allOk ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: allOk ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
