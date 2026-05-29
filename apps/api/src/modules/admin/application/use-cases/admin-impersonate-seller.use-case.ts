import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
import { NotFoundAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { canLogin } from '../../../seller/domain/policies/seller-access.policy';
import { AdminAuditService } from '../services/admin-audit.service';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

interface ImpersonateInput {
  adminId: string;
  adminRole: string;
  sellerId: string;
  reason?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

// Phase 28 (2026-05-21) — TTL tightened from 30 → 10 min. Debugging
// rarely needs more, and a leaked impersonation token's window of
// usefulness drops 3×. An extend-impersonation endpoint can be added
// if real support workflows demand it.
const IMPERSONATION_TTL_SECONDS = 10 * 60;

@Injectable()
export class AdminImpersonateSellerUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly envService: EnvService,
    private readonly auditService: AdminAuditService,
    private readonly logger: AppLoggerService,
    // Phase 28 (2026-05-21) — new dependencies for the hardened flow.
    //   audit:    mirror the action into the unified hash-chained
    //             AuditLog alongside AdminActionAuditLog.
    //   eventBus: emit seller.impersonated so the email-notification
    //             handler can warn the target out-of-band.
    //   redis:    store the JTI so the seller guard can refuse
    //             revoked tokens before their natural JWT exp.
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
  ) {
    this.logger.setContext('AdminImpersonateSellerUseCase');
  }

  async execute(input: ImpersonateInput) {
    const { adminId, adminRole, sellerId, reason, ipAddress, userAgent } = input;

    // Defense-in-depth role check.
    if (!['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole)) {
      throw new ForbiddenAppException('You do not have permission to impersonate sellers');
    }

    const seller = await this.adminRepo.findSellerByIdWithSelect(sellerId, {
      id: true,
      email: true,
      sellerName: true,
      sellerShopName: true,
      phoneNumber: true,
      status: true,
      isDeleted: true,
    });

    if (!seller || seller.isDeleted) {
      throw new NotFoundAppException('Seller not found');
    }
    // Phase 28 (2026-05-21) — refuse to impersonate sellers in
    // non-loginable statuses (SUSPENDED, REJECTED). Pre-Phase-28 the
    // token got minted regardless; the seller guard's canLogin check
    // would later 401 on the first request — but the audit row was
    // already written and the admin saw a misleading success. Reuse
    // the same canLogin policy the guard enforces.
    if (!canLogin(seller.status)) {
      throw new ForbiddenAppException(
        'Cannot impersonate a seller in this status. Unlock the account first.',
      );
    }

    const jti = randomUUID();

    // Phase 28 (2026-05-21) — store the JTI in Redis with the same
    // TTL as the JWT. The seller guard checks this key on every
    // impersonation-token request; end-impersonation deletes it.
    // This is what makes early revocation possible — the JWT itself
    // would still verify by signature until exp, but a missing
    // Redis key 401s the request anyway.
    await this.redis.set(
      `admin:impersonation:${jti}`,
      adminId,
      IMPERSONATION_TTL_SECONDS,
    );

    const accessToken = jwt.sign(
      {
        sub: seller.id,
        email: seller.email,
        roles: ['SELLER'],
        sessionId: `impersonation-${jti}`,
        impersonatedBy: adminId,
        impersonationJti: jti,
      },
      this.envService.getString('JWT_SELLER_SECRET'),
      { expiresIn: IMPERSONATION_TTL_SECONDS, algorithm: JWT_ALGORITHM },
    );

    // Log impersonation (new multi-actor + JTI shape).
    const impersonationLog = await this.adminRepo.createImpersonationLog({
      adminId,
      targetActorType: 'SELLER',
      targetActorId: sellerId,
      tokenId: `impersonation-${jti}`,
      tokenJti: jti,
      reason: reason ?? null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });

    await this.auditService.log({
      adminId,
      sellerId,
      actionType: 'SELLER_IMPERSONATED',
      metadata: { impersonationLogId: impersonationLog.id, jti, reason },
      ipAddress,
      userAgent,
    });

    // Phase 28 (2026-05-21) — mirror to unified AuditLog so the
    // generic admin-activity search surfaces this alongside other
    // security-sensitive admin actions.
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: adminRole,
        action: 'SELLER_IMPERSONATED',
        module: 'admin',
        resource: 'Seller',
        resourceId: sellerId,
        metadata: {
          impersonationLogId: impersonationLog.id,
          jti,
          reason: reason ?? null,
        },
        ipAddress,
        userAgent,
      })
      .catch((err) =>
        this.logger.warn(
          `Failed unified-audit write for SELLER_IMPERSONATED: ${(err as Error)?.message}`,
        ),
      );

    // Phase 28 — notify the target out-of-band. Email handler reads
    // this event to warn the seller their account was opened by
    // admin X — the only side-channel signal they get.
    this.eventBus
      .publish({
        eventName: 'seller.impersonated',
        aggregate: 'seller',
        aggregateId: sellerId,
        occurredAt: new Date(),
        payload: {
          sellerId,
          adminId,
          email: seller.email ?? null,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          reason: reason ?? null,
        },
      })
      .catch(() => undefined);

    this.logger.log(`Admin ${adminId} impersonating seller ${sellerId} (jti=${jti})`);

    return {
      accessToken,
      expiresIn: IMPERSONATION_TTL_SECONDS,
      seller: {
        sellerId: seller.id,
        sellerName: seller.sellerName,
        sellerShopName: seller.sellerShopName,
        email: seller.email,
        phoneNumber: seller.phoneNumber,
      },
    };
  }
}
