import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { EnvService } from '../../bootstrap/env/env.service';
import { MetricsRegistry } from './metrics.registry';

/**
 * Phase 8 (PR 8.4) — Prometheus scrape endpoint.
 *
 * Auth: a shared bearer token (`METRICS_BEARER_TOKEN`). The endpoint
 * is unauthenticated to the rest of the world and gated only by this
 * token. Why not regular admin auth: scrapers don't carry user-bound
 * JWTs and rotating the bearer token only requires a config change,
 * not a re-auth flow. The token defaults to empty (endpoint disabled).
 */
@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly registry: MetricsRegistry,
    private readonly env: EnvService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(
    @Headers('authorization') authHeader: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const expected = this.env.getOptional('METRICS_BEARER_TOKEN');
    if (!expected) {
      // Endpoint is disabled: return 404 so the path doesn't surface
      // the existence of metrics scraping in environments that don't
      // need it.
      res.status(HttpStatus.NOT_FOUND).send('Not Found');
      return;
    }
    const provided = (authHeader ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== expected) {
      throw new UnauthorizedException('Invalid metrics token');
    }
    res.send(this.registry.render());
  }
}
