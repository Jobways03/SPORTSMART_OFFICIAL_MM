import { Global, Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  AnyAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../guards';
import { PortalPushService } from './portal-push.service';
import { PortalStreamsController } from './portal-streams.controller';

/**
 * Phase 9 (PR 9.1) — realtime push module.
 *
 * The push service registers @OnEvent listeners at construction time;
 * the global event bus delivers events to it the moment domain code
 * publishes. No additional wiring needed in domain modules.
 */
@Global()
@Module({
  controllers: [PortalStreamsController],
  providers: [
    PortalPushService,
    AdminAuthGuard,
    AnyAuthGuard,
    SellerAuthGuard,
    UserAuthGuard,
  ],
  exports: [PortalPushService],
})
export class RealtimeModule {}
