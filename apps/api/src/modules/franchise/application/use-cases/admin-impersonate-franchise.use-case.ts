import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
import {
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../../admin/domain/repositories/admin.repository.interface';
import {
  FranchisePartnerRepository,
  FRANCHISE_PARTNER_REPOSITORY,
} from '../../domain/repositories/franchise.repository.interface';

interface ImpersonateInput {
  adminId: string;
  adminRole: string;
  franchiseId: string;
  reason?: string | null;
  ipAddress?: string;
  userAgent?: string;
}

// Phase 28 (2026-05-21) — TTL parity with the seller flow (10 min).
const IMPERSONATION_TTL_SECONDS = 10 * 60;

// Phase 28 — same allow-list the FranchiseAuthGuard enforces.
// SUSPENDED + DEACTIVATED franchises are not impersonatable; the
// audit-side fix earlier required this to land here too so a stale
// impersonation token doesn't get minted for an account the guard
// would 401 on the first request.
const IMPERSONATABLE_STATUSES = new Set(['PENDING', 'APPROVED', 'ACTIVE']);

@Injectable()
export class AdminImpersonateFranchiseUseCase {
  constructor(
    @Inject(FRANCHISE_PARTNER_REPOSITORY)
    private readonly franchiseRepo: FranchisePartnerRepository,
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
    // Phase 28 (2026-05-21) — new dependencies for the hardened flow.
    // Pre-Phase-28 the franchise impersonate use case wrote nothing
    // to audit and didn't track the JTI; both fixed here in lockstep
    // with the seller-side hardening.
    private readonly audit: AuditPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
  ) {
    this.logger.setContext('AdminImpersonateFranchiseUseCase');
  }

  async execute(input: ImpersonateInput) {
    const { adminId, adminRole, franchiseId, reason, ipAddress, userAgent } = input;

    // Phase 28 — defense-in-depth role check.
    if (!['SUPER_ADMIN', 'SELLER_ADMIN'].includes(adminRole)) {
      throw new ForbiddenAppException(
        'You do not have permission to impersonate franchise partners',
      );
    }

    const franchise = await this.franchiseRepo.findById(franchiseId);
    if (!franchise || franchise.isDeleted) {
      throw new NotFoundAppException('Franchise not found');
    }
    if (!IMPERSONATABLE_STATUSES.has(franchise.status)) {
      throw new ForbiddenAppException(
        'Cannot impersonate a franchise in this status. Reactivate the account first.',
      );
    }

    const jti = randomUUID();

    // Phase 28 (2026-05-21) — JTI in Redis with JWT-matched TTL. The
    // franchise guard checks this key on every impersonation-token
    // request; end-impersonation deletes it. Closes the "JWT still
    // verifies until exp" revocation gap.
    await this.redis.set(
      `admin:impersonation:${jti}`,
      adminId,
      IMPERSONATION_TTL_SECONDS,
    );

    const accessToken = jwt.sign(
      {
        sub: franchise.id,
        email: franchise.email,
        roles: ['FRANCHISE'],
        sessionId: `impersonation-${jti}`,
        impersonatedBy: adminId,
        impersonationJti: jti,
      },
      this.envService.getString('JWT_FRANCHISE_SECRET'),
      { expiresIn: IMPERSONATION_TTL_SECONDS, algorithm: JWT_ALGORITHM },
    );

    // Phase 28 — log to AdminImpersonationLog via the multi-actor
    // shape (the schema gained target_actor_type + target_actor_id
    // columns in this phase so franchise rows are storable).
    const impersonationLog = await this.adminRepo.createImpersonationLog({
      adminId,
      targetActorType: 'FRANCHISE',
      targetActorId: franchiseId,
      tokenId: `impersonation-${jti}`,
      tokenJti: jti,
      reason: reason ?? null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
    });

    // Phase 28 — mirror to unified AuditLog for grep-friendly
    // discovery in the admin-activity search.
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: adminRole,
        action: 'FRANCHISE_IMPERSONATED',
        module: 'admin',
        resource: 'FranchisePartner',
        resourceId: franchiseId,
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
          `Failed unified-audit write for FRANCHISE_IMPERSONATED: ${(err as Error)?.message}`,
        ),
      );

    this.eventBus
      .publish({
        eventName: 'franchise.impersonated',
        aggregate: 'franchise',
        aggregateId: franchiseId,
        occurredAt: new Date(),
        payload: {
          franchiseId,
          adminId,
          email: franchise.email ?? null,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
          reason: reason ?? null,
        },
      })
      .catch(() => undefined);

    this.logger.log(
      `Admin ${adminId} impersonating franchise ${franchiseId} (jti=${jti})`,
    );

    return {
      accessToken,
      expiresIn: IMPERSONATION_TTL_SECONDS,
      franchise: {
        franchiseId: franchise.id,
        franchiseCode: franchise.franchiseCode,
        ownerName: franchise.ownerName,
        businessName: franchise.businessName,
        email: franchise.email,
      },
    };
  }
}
