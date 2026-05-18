import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MetricsRegistry, CounterHandle, HistogramHandle } from './metrics.registry';
import type { DomainEvent } from '../../bootstrap/events/domain-event.interface';

/**
 * Phase 11 (2026-05-16) — Business metrics via OnEvent.
 *
 * Pre-Phase-11 the metrics registry only exposed infrastructure
 * primitives (HTTP latency, cron-runs, authz audit). Operations
 * dashboards (Grafana panels) had no way to ask "orders placed per
 * minute" or "GMV in the last hour" without writing SQL against the
 * live database — which is slow + competes with the order path for
 * connections.
 *
 * Each business event publishes through the existing in-process bus
 * (and onto the outbox). We subscribe here and increment Prometheus
 * counters / observe histograms. Zero changes to publisher call sites
 * — they already emit; we just listen.
 *
 * Why @OnEvent + central handler vs sprinkling `metrics.inc()` into
 * every service:
 *   • One place to ratchet metric names + label cardinality.
 *   • No risk of forgetting to update metrics when a new feature
 *     ships — the event is the trigger, and the handler runs no
 *     matter where the publish originated.
 *   • Failure isolation: a metric emission error never affects the
 *     business path; the registry's increment is in-memory and
 *     synchronous, so it can't reasonably fail.
 */
@Injectable()
export class BusinessMetricsHandler implements OnModuleInit {
  private ordersPlaced!: CounterHandle;
  private paymentsCaptured!: CounterHandle;
  private paymentsFailed!: CounterHandle;
  private refundsProcessed!: CounterHandle;
  private shipmentsCreated!: CounterHandle;
  private shipmentsDelivered!: CounterHandle;
  private returnsRequested!: CounterHandle;
  private disputesFiled!: CounterHandle;
  private gmvRupees!: HistogramHandle;
  private refundAmountRupees!: HistogramHandle;

  constructor(private readonly metrics: MetricsRegistry) {}

  onModuleInit(): void {
    // Register all metrics at boot so the /metrics endpoint exposes
    // HELP / TYPE descriptors even before the first event lands.
    // Grafana panels pinned to these names don't "no-data" on cold
    // start.
    this.ordersPlaced = this.metrics.counter(
      'orders_placed_total',
      'Master orders placed by customers.',
    );
    this.paymentsCaptured = this.metrics.counter(
      'payments_captured_total',
      'Payments successfully captured (Razorpay or COD).',
    );
    this.paymentsFailed = this.metrics.counter(
      'payments_failed_total',
      'Payment attempts that ended in FAILED.',
    );
    this.refundsProcessed = this.metrics.counter(
      'refunds_processed_total',
      'Refunds reached terminal SUCCEEDED state.',
    );
    this.shipmentsCreated = this.metrics.counter(
      'shipments_created_total',
      'Shipping labels created (iThink or self-delivery).',
    );
    this.shipmentsDelivered = this.metrics.counter(
      'shipments_delivered_total',
      'Sub-orders marked DELIVERED by carrier webhook or self-delivery.',
    );
    this.returnsRequested = this.metrics.counter(
      'returns_requested_total',
      'Customer-initiated return requests.',
    );
    this.disputesFiled = this.metrics.counter(
      'disputes_filed_total',
      'Disputes opened by customers, sellers, or admin.',
    );
    // Histograms — bucketed in rupees so the /metrics output is
    // human-readable. Buckets cover ₹100 → ₹100,000 (1Cr would need
    // a wider top bucket; revisit when AOV grows).
    this.gmvRupees = this.metrics.histogram(
      'order_gmv_rupees',
      'Gross merchandise value per master order in rupees.',
      [100, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000],
    );
    this.refundAmountRupees = this.metrics.histogram(
      'refund_amount_rupees',
      'Refund amount distribution per completed refund.',
      [50, 200, 500, 1000, 2500, 5000, 10_000, 25_000, 100_000],
    );
  }

  // ── Order placement ────────────────────────────────────────────

  @OnEvent('orders.master.created')
  onOrderPlaced(event: DomainEvent): void {
    this.ordersPlaced.inc();
    const totalAmount = (event.payload as { totalAmount?: number | string } | null)
      ?.totalAmount;
    if (totalAmount != null) {
      const rupees = Number(totalAmount);
      if (Number.isFinite(rupees) && rupees > 0) {
        this.gmvRupees.observe(rupees);
      }
    }
  }

  // ── Payments ───────────────────────────────────────────────────

  @OnEvent('payments.payment.captured')
  onPaymentCaptured(): void {
    this.paymentsCaptured.inc();
  }

  @OnEvent('payments.payment.failed')
  onPaymentFailed(): void {
    this.paymentsFailed.inc();
  }

  // ── Refunds ───────────────────────────────────────────────────

  @OnEvent('returns.refund.completed')
  onRefundCompleted(event: DomainEvent): void {
    this.refundsProcessed.inc();
    const amount = (event.payload as { refundAmount?: number | string; amount?: number | string } | null)
      ?.refundAmount ?? (event.payload as { amount?: number | string } | null)?.amount;
    if (amount != null) {
      const rupees = Number(amount);
      if (Number.isFinite(rupees) && rupees > 0) {
        this.refundAmountRupees.observe(rupees);
      }
    }
  }

  // ── Shipments ─────────────────────────────────────────────────

  @OnEvent('shipping.shipment.dispatched')
  onShipmentCreated(): void {
    this.shipmentsCreated.inc();
  }

  @OnEvent('shipping.shipment.delivered')
  onShipmentDelivered(): void {
    this.shipmentsDelivered.inc();
  }

  @OnEvent('orders.sub_order.delivered')
  onSubOrderDelivered(): void {
    // Self-delivery flows don't fire shipping.shipment.delivered;
    // count both paths into the same metric so dashboards see the
    // combined delivered-count regardless of the fulfillment node.
    this.shipmentsDelivered.inc();
  }

  // ── Returns ───────────────────────────────────────────────────

  @OnEvent('returns.requested')
  onReturnRequested(): void {
    this.returnsRequested.inc();
  }

  // ── Disputes ──────────────────────────────────────────────────

  @OnEvent('disputes.filed')
  onDisputeFiled(): void {
    this.disputesFiled.inc();
  }
}
