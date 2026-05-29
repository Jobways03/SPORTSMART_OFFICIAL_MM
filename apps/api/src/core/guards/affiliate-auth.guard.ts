import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { JWT_VERIFY_OPTIONS } from '../auth/jwt-constants';
import { readAccessCookie } from '../auth/auth-cookie.helper';
import {
  ForbiddenAppException,
  UnauthorizedAppException,
} from '../exceptions';

export interface AffiliateTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  /** Phase 22 (2026-05-20) — session id stamped by login service.
   *  Required for session-revocation lookup. Tokens minted without
   *  this claim are rejected. */
  sessionId: string;
}

/**
 * Affiliate auth guard.
 *
 * Phase 22 (2026-05-20) — Two audit-driven changes:
 *
 *   1. PENDING_APPROVAL is now blocked. Aligns with the affiliate
 *      registration audit's "login allowed only after approval"
 *      policy. Pre-Phase-22 the guard let PENDING affiliates reach
 *      every authed route — anyone who registered could browse the
 *      dashboard before admin review.
 *
 *   2. The guard now validates the AffiliateSession row referenced
 *      by the JWT's `sessionId` claim. Login already creates the
 *      session row and stamps the id into the token, but the prior
 *      guard never read the table — making /affiliate/auth/logout's
 *      revocation pointless. We now check: session exists, not
 *      revoked, not expired.
 */
@Injectable()
export class AffiliateAuthGuard implements CanActivate {
  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authHeader = request.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;
    const token = bearer ?? readAccessCookie(request, 'affiliate');

    if (!token) {
      throw new UnauthorizedAppException('Authentication required');
    }

    let payload: AffiliateTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_AFFILIATE_SECRET'),
        JWT_VERIFY_OPTIONS,
      ) as AffiliateTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }

    if (!payload.sub || !payload.roles?.includes('AFFILIATE')) {
      throw new UnauthorizedAppException('Invalid affiliate token');
    }
    if (!payload.sessionId) {
      // Pre-Phase-22 tokens lacked sessionId; rejecting them forces a
      // re-login under the new token shape rather than letting an old
      // unbounded JWT survive.
      throw new UnauthorizedAppException('Invalid affiliate token');
    }

    // Phase 22 (2026-05-20) — session-row check. Reject if the session
    // is missing, revoked, or expired. The login service writes
    // AffiliateSession.id into the JWT sessionId claim; the refresh
    // service rotates the row but keeps the id. Revoking a session
    // (logout, theft detection, admin action) flips revokedAt, which
    // is observed on the very next request.
    const session = await this.prisma.affiliateSession.findUnique({
      where: { id: payload.sessionId },
      select: {
        id: true,
        affiliateId: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    if (!session || session.affiliateId !== payload.sub) {
      throw new UnauthorizedAppException('Session not found');
    }
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedAppException('Session expired');
    }

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) {
      throw new UnauthorizedAppException('Affiliate not found');
    }
    // Phase 22 (2026-05-20) — Mirror login's status gate.
    //   Allowed:  ACTIVE, INACTIVE
    //   Blocked:  PENDING_APPROVAL, REJECTED, SUSPENDED
    if (
      ['PENDING_APPROVAL', 'REJECTED', 'SUSPENDED'].includes(affiliate.status)
    ) {
      const code =
        affiliate.status === 'PENDING_APPROVAL'
          ? 'AFFILIATE_PENDING_APPROVAL'
          : affiliate.status === 'REJECTED'
            ? 'AFFILIATE_REJECTED'
            : 'AFFILIATE_SUSPENDED';
      const message =
        affiliate.status === 'PENDING_APPROVAL'
          ? 'Your affiliate application is under review.'
          : 'Your affiliate account is no longer active. Please contact support.';
      throw new ForbiddenAppException(message, code);
    }

    request.affiliateId = payload.sub;
    request.affiliateEmail = affiliate.email;
    request.affiliateStatus = affiliate.status;
    request.sessionId = session.id;
    return true;
  }
}
