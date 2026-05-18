import { Controller, Get, HttpCode, HttpStatus, Query, Res } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { RedisService } from '../../bootstrap/cache/redis.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { ExternalDepsProbeService } from './external-deps-probe.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly env: EnvService,
    private readonly externalProbe: ExternalDepsProbeService,
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
   *
   * Phase 11 (2026-05-16) — External-dependency probes are optional
   * and OFF by default for the LB-facing /health route to keep the
   * happy path under a few ms. Set `?external=1` (or the env flag
   * `HEALTH_EXTERNAL_PROBES_DEFAULT=true`) to include Razorpay / S3 /
   * Cloudinary. The full probe lives at `/health/deps` so dashboards
   * and dedicated alerts can call it on their own cadence without
   * tying it to LB readiness.
   */
  @Get()
  @ApiQuery({ name: 'external', required: false })
  async check(
    @Res({ passthrough: true }) res: Response,
    @Query('external') external?: string,
  ) {
    const checks: Record<string, unknown> = {};

    try {
      // Phase 11 (2026-05-16) — use $queryRaw template literal rather
      // than $queryRawUnsafe. Both work here (no params), but the
      // template-literal form is the team's standard and removes the
      // grep noise of "unsafe" calls in health code.
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

    // Phase 11 (2026-05-16) — opt-in external probes. Counted into
    // the overall `healthy` boolean only when explicitly requested
    // (default OFF). LBs that need external-dependency awareness
    // should poll /health?external=1 or set the env default.
    const includeExternal =
      external === '1' ||
      external === 'true' ||
      this.env.getString('HEALTH_EXTERNAL_PROBES_DEFAULT', 'false') === 'true';
    if (includeExternal) {
      const external = await this.externalProbe.probeAll();
      checks.external = external;
    }

    const healthy = this.allOk(checks);
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      success: healthy,
      status: healthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Phase 11 (2026-05-16) — dedicated external-deps probe.
   *
   * Returns Razorpay / S3 / Cloudinary status without touching DB or
   * Redis. Use for dashboards + dedicated alerts ("Razorpay degraded
   * for 5 minutes") on a cadence independent of LB readiness.
   */
  @Get('deps')
  async deps(@Res({ passthrough: true }) res: Response) {
    const probes = await this.externalProbe.probeAll();
    const anyDegraded = Object.values(probes).some((p) => p.status === 'degraded');
    res.status(anyDegraded ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK);
    return {
      success: !anyDegraded,
      probes,
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

  /**
   * Walk the (possibly nested) check tree and return false if any
   * leaf value indicates failure. Treats the new `external` nested
   * object's `status` strings consistently with the legacy
   * 'ok' / 'error' string leaves.
   */
  private allOk(checks: Record<string, unknown>): boolean {
    for (const value of Object.values(checks)) {
      if (typeof value === 'string') {
        if (value !== 'ok') return false;
        continue;
      }
      if (value && typeof value === 'object') {
        // External-probe leaves: { razorpay: { status: 'ok' | 'degraded' | 'skipped' } }
        for (const child of Object.values(value as Record<string, { status?: string }>)) {
          const s = child?.status;
          if (s === 'degraded') return false;
        }
      }
    }
    return true;
  }
}
