import { Global, Module } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry';
import { MetricsController } from './metrics.controller';

/**
 * Phase 8 (PR 8.4) — global metrics module. The registry is a
 * singleton; domain code calls `registry.counter('returns_created_total', ...)`
 * once at boot and increments thereafter.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsRegistry],
  exports: [MetricsRegistry],
})
export class MetricsModule {}
