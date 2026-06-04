import { Module } from '@nestjs/common';
import { UserAuthGuard } from '../../core/guards';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';
import { WishlistOrphanCleanupCron } from './wishlist-orphan-cleanup.cron';

/**
 * Wishlist module.
 *
 * Phase 202 — added the orphan-cleanup cron (#17). The cron's deps
 * (LeaderElectedCron, CronInstrumentationService) come from global
 * modules (SchedulerModule / CronObservabilityModule); EventEmitter2
 * (used by WishlistService for the move-to-cart event) is provided by
 * the global EventEmitterModule. No extra imports are required here.
 */
@Module({
  controllers: [WishlistController],
  providers: [UserAuthGuard, WishlistService, WishlistOrphanCleanupCron],
  exports: [WishlistService],
})
export class WishlistModule {}
