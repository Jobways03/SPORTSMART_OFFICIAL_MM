import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { RedisService } from '../../bootstrap/cache/redis.service';
import { JWT_VERIFY_OPTIONS } from '../auth/jwt-constants';
import { readAccessCookie } from '../auth/auth-cookie.helper';
import { UnauthorizedAppException } from '../exceptions';

export interface FranchiseTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  sessionId: string;
  /** Phase 28 (2026-05-21) — set on admin-minted impersonation
   *  tokens. The guard short-circuits the session-row lookup when
   *  this claim is present (the synthetic sessionId has no row).
   *  Mirror of SellerAuthGuard's seller-impersonation handling. */
  impersonatedBy?: string;
  /** Phase 28 — JTI for Redis-backed revocation lookup. */
  impersonationJti?: string;
}

@Injectable()
export class FranchiseAuthGuard implements CanActivate {
  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Follow-up #H40 — accept token from Bearer OR httpOnly cookie.
    const authHeader = request.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;
    const token = bearer ?? readAccessCookie(request, 'franchise');

    if (!token) {
      throw new UnauthorizedAppException('Authentication required');
    }

    let payload: FranchiseTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_FRANCHISE_SECRET'),
        JWT_VERIFY_OPTIONS,
      ) as FranchiseTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }

    if (!payload.sub || !payload.roles?.includes('FRANCHISE')) {
      throw new UnauthorizedAppException('Invalid franchise token');
    }

    // Phase 28 (2026-05-21) — impersonation short-circuit. Tokens
    // minted by AdminImpersonateFranchiseUseCase carry impersonatedBy
    // and use a synthetic sessionId (`impersonation-<jti>`) that has
    // no FranchiseSession row. Mirror of the seller-guard pattern.
    const isImpersonation = !!payload.impersonatedBy;

    if (!isImpersonation) {
      if (!payload.sessionId) {
        throw new UnauthorizedAppException('Invalid token: missing session');
      }
      const session = await this.prisma.franchiseSession.findUnique({
        where: { id: payload.sessionId },
        select: {
          id: true,
          revokedAt: true,
          expiresAt: true,
          franchisePartnerId: true,
        },
      });
      if (!session || session.franchisePartnerId !== payload.sub) {
        throw new UnauthorizedAppException('Session not found');
      }
      if (session.revokedAt) {
        throw new UnauthorizedAppException('Session has been revoked');
      }
      if (session.expiresAt < new Date()) {
        throw new UnauthorizedAppException('Session has expired');
      }
      request.sessionId = session.id;
    } else if (payload.impersonationJti) {
      // Phase 28 — true revocation check. The JTI key lives in Redis
      // with the same TTL as the JWT exp; end-impersonation deletes
      // it. If the key is missing, the impersonation was revoked
      // before its natural expiry → 401 even though the JWT itself
      // would still verify by signature.
      const alive = await this.redis.get<string>(
        `admin:impersonation:${payload.impersonationJti}`,
      );
      if (!alive) {
        throw new UnauthorizedAppException(
          'Impersonation session has been revoked',
        );
      }
    }

    // Verify the franchise account exists and is not suspended/deactivated.
    // PENDING partners are allowed so they can complete their profile.
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, email: true, isDeleted: true },
    });
    if (!franchise || franchise.isDeleted) {
      throw new UnauthorizedAppException('Franchise not found');
    }
    if (['SUSPENDED', 'DEACTIVATED'].includes(franchise.status)) {
      throw new UnauthorizedAppException('Franchise account has been suspended or deactivated');
    }

    request.franchiseId = payload.sub;
    request.franchiseEmail = franchise.email;
    request.franchiseStatus = franchise.status;
    // Phase 55 polish (2026-05-22) — populate franchiseUserId for
    // forensic attribution. Today the franchise model is
    // single-user-per-franchise so the user id equals the franchise
    // id. When multi-user-per-franchise lands the JWT will carry
    // a separate `userId` claim; this line becomes
    // `payload.userId ?? payload.sub`. Setting it here means audit
    // ledger writes (procurement receipt, stock adjust, etc.) can
    // read req.franchiseUserId without a guard-level change.
    request.franchiseUserId = (payload as any).userId ?? payload.sub;
    if (isImpersonation) {
      request.impersonatedBy = payload.impersonatedBy;
      request.impersonationJti = payload.impersonationJti;
      request.isImpersonation = true;
    }
    return true;
  }
}
