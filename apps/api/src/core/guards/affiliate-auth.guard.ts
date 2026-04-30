import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { UnauthorizedAppException } from '../exceptions';

export interface AffiliateTokenPayload {
  sub: string;
  email: string;
  roles: string[];
}

/**
 * Affiliate-self-service auth guard. Stateless JWT — session
 * revocation table deferred to Phase 2; for now the JWT_ACCESS_TTL
 * (24h-ish) provides the bound on credential lifetime per SRS §16.1.
 *
 * Token lifecycle parity with the FranchiseAuthGuard but no
 * AffiliateSession table: a re-login is required to refresh.
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

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedAppException('Authentication required');
    }

    const token = authHeader.slice(7);

    let payload: AffiliateTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_AFFILIATE_SECRET'),
      ) as AffiliateTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }

    if (!payload.sub || !payload.roles?.includes('AFFILIATE')) {
      throw new UnauthorizedAppException('Invalid affiliate token');
    }

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, email: true },
    });
    if (!affiliate) {
      throw new UnauthorizedAppException('Affiliate not found');
    }
    // SUSPENDED + REJECTED accounts can't access the portal at all.
    // INACTIVE can — the SRS lets them log in to see their balance,
    // they just can't earn new commissions (enforced at order time).
    if (['SUSPENDED', 'REJECTED'].includes(affiliate.status)) {
      throw new UnauthorizedAppException(
        'Your affiliate account is no longer active. Please contact support.',
      );
    }

    request.affiliateId = payload.sub;
    request.affiliateEmail = affiliate.email;
    request.affiliateStatus = affiliate.status;
    return true;
  }
}
