import { Module } from '@nestjs/common';

import { EnvModule } from './bootstrap/env/env.module';
import { PrismaModule } from './bootstrap/database/prisma.module';
import { RedisModule } from './bootstrap/cache/redis.module';
import { LoggingModule } from './bootstrap/logging/logging.module';
import { EventsModule } from './bootstrap/events/events.module';
import { SecurityModule } from './bootstrap/security/security.module';
import { EmailModule } from './integrations/email/email.module';

// core
import { HealthController } from './core/health/health.controller';

// business modules
import { IdentityModule } from './modules/identity/module';
import { SellerModule } from './modules/seller/module';
import { CatalogModule } from './modules/catalog/module';
import { SearchModule } from './modules/search/module';
import { InventoryModule } from './modules/inventory/module';
import { CartModule } from './modules/cart/module';
import { CheckoutModule } from './modules/checkout/module';
import { OrdersModule } from './modules/orders/module';
import { PaymentsModule } from './modules/payments/module';
import { CodModule } from './modules/cod/module';
import { ShippingModule } from './modules/shipping/module';
import { ReturnsModule } from './modules/returns/module';
import { SettlementsModule } from './modules/settlements/module';
import { AffiliateModule } from './modules/affiliate/module';
import { FranchiseModule } from './modules/franchise/module';
import { NotificationsModule } from './modules/notifications/module';
import { AdminControlTowerModule } from './modules/admin-control-tower/module';
import { AdminModule } from './modules/admin/module';
import { AuditModule } from './modules/audit/module';
import { FilesModule } from './modules/files/module';
import { CommissionModule } from './modules/commission/module';
import { DiscountsModule } from './modules/discounts/discounts.module';
import { AiModule } from './modules/ai/ai.module';

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

    // business
    IdentityModule,
    SellerModule,
    CatalogModule,
    SearchModule,
    InventoryModule,
    CartModule,
    CheckoutModule,
    OrdersModule,
    PaymentsModule,
    CodModule,
    ShippingModule,
    ReturnsModule,
    SettlementsModule,
    AffiliateModule,
    FranchiseModule,
    NotificationsModule,
    AdminControlTowerModule,
    AdminModule,
    AuditModule,
    FilesModule,
    CommissionModule,
    DiscountsModule,
    AiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
