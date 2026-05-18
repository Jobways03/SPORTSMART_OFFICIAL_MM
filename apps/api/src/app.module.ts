import { Module } from '@nestjs/common';

import { EnvModule } from './bootstrap/env/env.module';
import { PrismaModule } from './bootstrap/database/prisma.module';
import { RedisModule } from './bootstrap/cache/redis.module';
import { LoggingModule } from './bootstrap/logging/logging.module';
import { EventsModule } from './bootstrap/events/events.module';
import { SecurityModule } from './bootstrap/security/security.module';
import { EmailModule } from './integrations/email/email.module';
import { IThinkModule } from './integrations/ithink/ithink.module';
import { WhatsAppModule } from './integrations/whatsapp/whatsapp.module';

// core
import { HealthController } from './core/health/health.controller';
import { ExternalDepsProbeService } from './core/health/external-deps-probe.service';

// business modules
import { IdentityModule } from './modules/identity/module';
import { SellerModule } from './modules/seller/module';
import { CatalogModule } from './modules/catalog/module';
import { SearchModule } from './modules/search/module';
import { InventoryModule } from './modules/inventory/module';
import { CartModule } from './modules/cart/module';
import { WalletModule } from './modules/wallet/module';
import { WishlistModule } from './modules/wishlist/wishlist.module';
import { SupportModule } from './modules/support/module';
import { OwnBrandModule } from './modules/own-brand/module';
import { PaymentOpsModule } from './modules/payments-ops/module';
import { DisputesModule } from './modules/disputes/module';
import { LiabilityLedgerModule } from './modules/liability-ledger/module';
import { ReconciliationModule } from './modules/reconciliation/module';
import { AnalyticsModule } from './modules/analytics/module';
import { CheckoutModule } from './modules/checkout/module';
import { OrdersModule } from './modules/orders/module';
import { PaymentsModule } from './modules/payments/module';
import { CodModule } from './modules/cod/module';
import { ShippingModule } from './modules/shipping/module';
import { ShippingOptionsModule } from './modules/shipping-options/shipping-options.module';
import { ReturnsModule } from './modules/returns/module';
import { SettlementsModule } from './modules/settlements/module';
import { AffiliateModule } from './modules/affiliate/module';
import { FranchiseModule } from './modules/franchise/module';
import { NotificationsModule } from './modules/notifications/module';
import { AdminControlTowerModule } from './modules/admin-control-tower/module';
import { AdminModule } from './modules/admin/module';
import { AdminMfaModule } from './modules/admin-mfa/module';
import { AuditModule } from './modules/audit/module';
import { FilesModule } from './modules/files/module';
import { CommissionModule } from './modules/commission/module';
import { DiscountsModule } from './modules/discounts/discounts.module';
import { AiModule } from './modules/ai/ai.module';
import { AccountsModule } from './modules/accounts/module';
import { StorefrontMenuModule } from './modules/storefront-menu/storefront-menu.module';
import { AccessLogModule } from './modules/access-log/module';
import { PayoutsModule } from './modules/payouts/module';
import { ContentModule } from './modules/content/module';
import { SchedulerModule } from './bootstrap/scheduler/scheduler.module';
import { IdempotencyModule } from './core/idempotency/idempotency.module';
import { GuardsModule } from './core/guards/guards.module';
import { CaseDuplicateModule } from './core/case-duplicate/case-duplicate.module';
import { SlaModule } from './core/sla/sla.module';
import { RiskModule } from './core/risk/risk.module';
import { QueuesModule } from './core/queues/queues.module';
import { RetentionModule } from './core/retention/retention.module';
import { FileIntegrityModule } from './core/file-integrity/file-integrity.module';
import { ErasureModule } from './core/erasure/erasure.module';
import { CronObservabilityModule } from './core/cron-observability/cron-observability.module';
import { MetricsModule } from './core/metrics/metrics.module';
import { RealtimeModule } from './core/realtime/realtime.module';
import { I18nModule } from './core/i18n/i18n.module';
import { CaseTimelineModule } from './core/case-timeline/case-timeline.module';
import { ApiKeysModule } from './core/api-keys/api-keys.module';
import { WebhooksModule } from './core/webhooks/webhooks.module';
import { SandboxModule } from './core/sandbox/sandbox.module';
import { MoneyModule } from './core/money/money.module';
import { PaymentsSagaModule } from './modules/payments-saga/module';
import { RefundInstructionsModule } from './modules/refund-instructions/module';
import { TaxModule } from './modules/tax/module';

@Module({
  imports: [
    // platform
    EnvModule,
    LoggingModule,
    SecurityModule,
    PrismaModule,
    RedisModule,
    EventsModule,
    EmailModule,
    IThinkModule,
    WhatsAppModule,
    IdempotencyModule,
    GuardsModule,
    CaseDuplicateModule,
    SlaModule,
    RiskModule,
    QueuesModule,
    RetentionModule,
    FileIntegrityModule,
    ErasureModule,
    CronObservabilityModule,
    MetricsModule,
    RealtimeModule,
    I18nModule,
    CaseTimelineModule,
    ApiKeysModule,
    WebhooksModule,
    SandboxModule,
    MoneyModule,
    PaymentsSagaModule,
    RefundInstructionsModule,
    TaxModule,

    // business
    IdentityModule,
    SellerModule,
    CatalogModule,
    SearchModule,
    InventoryModule,
    CartModule,
    WalletModule,
    WishlistModule,
    SupportModule,
    OwnBrandModule,
    PaymentOpsModule,
    DisputesModule,
    LiabilityLedgerModule,
    ReconciliationModule,
    AnalyticsModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
    CodModule,
    ShippingModule,
    ShippingOptionsModule,
    ReturnsModule,
    SettlementsModule,
    AffiliateModule,
    FranchiseModule,
    NotificationsModule,
    AdminControlTowerModule,
    AdminModule,
    AdminMfaModule,
    AuditModule,
    FilesModule,
    CommissionModule,
    DiscountsModule,
    AiModule,
    AccountsModule,
    StorefrontMenuModule,
    AccessLogModule,
    PayoutsModule,
    ContentModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
  providers: [
    // Phase 11 (2026-05-16) — external-dependency probe used by
    // HealthController. Lives at the app level rather than in a
    // dedicated module since it has no own state and is only used
    // by the one controller above it.
    ExternalDepsProbeService,
  ],
})
export class AppModule {}
