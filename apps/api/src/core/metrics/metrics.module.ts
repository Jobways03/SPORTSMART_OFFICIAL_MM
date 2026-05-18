import { Global, Module } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry';
import { MetricsController } from './metrics.controller';
import { BusinessMetricsHandler } from './business-metrics.handler';

/**
 * Phase 8 (PR 8.4) — global metrics module. The registry is a
 * singleton; domain code calls `registry.counter('returns_created_total', ...)`
 * once at boot and increments thereafter.
 *
 * Phase 11 (2026-05-16) — `BusinessMetricsHandler` subscribes to
 * the key domain events (orders.master.created, payments.payment.*,
 * returns.refund.completed, shipping.*, disputes.filed) and emits
 * Prometheus counters / GMV + refund histograms. The handler is a
 * passive listener — it does NOT change any business-path behavior.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsRegistry, BusinessMetricsHandler],
  exports: [MetricsRegistry],
})
export class MetricsModule {}
