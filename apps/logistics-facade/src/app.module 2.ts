import { Module } from '@nestjs/common';

// Bootstrap (platform)
import { EnvModule } from './bootstrap/env/env.module';
import { LoggerModule } from './bootstrap/logging/logger.module';
import { PrismaModule } from './bootstrap/database/prisma.module';
import { RedisModule } from './bootstrap/cache/redis.module';
import { EventBusModule } from './bootstrap/events/event-bus.module';
import { SchedulerModule } from './bootstrap/scheduler/scheduler.module';
import { SecurityModule } from './bootstrap/security/security.module';

// Core
import { ApiKeysModule } from './core/api-keys/api-keys.module';
import { HealthModule } from './core/health/health.module';

// Business modules
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { NdrModule } from './modules/ndr/ndr.module';
import { RtoModule } from './modules/rto/rto.module';
import { QcModule } from './modules/qc/qc.module';
import { CodRemittanceModule } from './modules/cod-remittance/cod-remittance.module';
import { PartnersModule } from './modules/partners/partners.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

/**
 * Wiring follows apps/api/src/app.module.ts: bootstrap (platform)
 * modules first, then core, then business. EnvModule MUST be first
 * because every downstream provider may inject EnvService at
 * construction time.
 */
@Module({
  imports: [
    // platform
    EnvModule,
    LoggerModule,
    SecurityModule,
    PrismaModule,
    RedisModule,
    EventBusModule,
    SchedulerModule,

    // core
    ApiKeysModule,
    HealthModule,
    WebhooksModule,

    // business
    ShipmentsModule,
    TrackingModule,
    ReturnsModule,
    NdrModule,
    RtoModule,
    QcModule,
    CodRemittanceModule,
    PartnersModule,
  ],
})
export class AppModule {}
