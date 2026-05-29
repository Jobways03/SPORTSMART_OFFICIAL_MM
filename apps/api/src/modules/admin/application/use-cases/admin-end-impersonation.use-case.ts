import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotFoundAppException } from '../../../../core/exceptions';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface EndImpersonationInput {
  tokenJti: string;
  /** Who triggered the end. Admin id when called from the admin-side
   *  end endpoint; target actor id when called from the target's
   *  self-service "exit impersonation" route (future). */
  endedByActorId: string;
  endedByActorRole?: string;
  reason?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Phase 28 (2026-05-21) — terminate an active impersonation early.
 *
 * Pre-Phase-28 there was no way to end an impersonation before its
 * 30-min JWT exp. This use case:
 *
 *   1. Deletes the JTI key in Redis so AdminImpersonationGuard /
 *      SellerAuthGuard / FranchiseAuthGuard 401 the next request
 *      with the still-valid JWT.
 *   2. Stamps endedAt + revokedReason on the AdminImpersonationLog
 *      row so audit replay distinguishes clean exit from natural
 *      JWT expiry.
 *   3. Mirrors to unified AuditLog.
 *   4. Emits <actor>.impersonation_ended for any downstream
 *      notification handlers.
 *
 * Idempotent — calling on an already-ended log returns success
 * without re-stamping. The Redis delete is also idempotent.
 */
@Injectable()
export class AdminEndImpersonationUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly redis: RedisService,
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminEndImpersonationUseCase');
  }

  async execute(input: EndImpersonationInput): Promise<{ ended: true }> {
    const log = await this.adminRepo.findImpersonationLogByJti(input.tokenJti);
    if (!log) {
      throw new NotFoundAppException('Impersonation session not found');
    }

    // Idempotent: already-ended log just returns success.
    if (log.endedAt || log.revokedAt) {
      // Still delete the Redis key in case it slipped past a prior
      // partial run (delete is a no-op if absent).
      await this.redis.del(`admin:impersonation:${input.tokenJti}`);
      return { ended: true };
    }

    const now = new Date();
    await this.adminRepo.endImpersonationLog({
      id: log.id,
      endedAt: now,
      revokedAt: now,
      revokedReason: input.reason ?? 'admin_ended',
    });
    await this.redis.del(`admin:impersonation:${input.tokenJti}`);

    const action =
      log.targetActorType === 'SELLER'
        ? 'SELLER_IMPERSONATION_ENDED'
        : 'FRANCHISE_IMPERSONATION_ENDED';

    this.audit
      .writeAuditLog({
        actorId: input.endedByActorId,
        actorRole: input.endedByActorRole,
        action,
        module: 'admin',
        resource: log.targetActorType === 'SELLER' ? 'Seller' : 'FranchisePartner',
        resourceId: log.targetActorId,
        metadata: {
          impersonationLogId: log.id,
          jti: input.tokenJti,
          adminId: log.adminId,
          reason: input.reason ?? null,
        },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      })
      .catch((err) =>
        this.logger.warn(
          `Failed unified-audit write for ${action}: ${(err as Error)?.message}`,
        ),
      );

    this.eventBus
      .publish({
        eventName:
          log.targetActorType === 'SELLER'
            ? 'seller.impersonation_ended'
            : 'franchise.impersonation_ended',
        aggregate:
          log.targetActorType === 'SELLER' ? 'seller' : 'franchise',
        aggregateId: log.targetActorId,
        occurredAt: now,
        payload: {
          targetActorId: log.targetActorId,
          adminId: log.adminId,
          reason: input.reason ?? null,
        },
      })
      .catch(() => undefined);

    this.logger.log(
      `Impersonation ended: log=${log.id} jti=${input.tokenJti} by ${input.endedByActorId}`,
    );

    return { ended: true };
  }
}
