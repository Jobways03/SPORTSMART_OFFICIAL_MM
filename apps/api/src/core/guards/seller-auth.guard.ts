import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { UnauthorizedAppException } from '../exceptions';

export interface SellerTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  sessionId: string;
  /** Set on impersonation tokens minted by an admin. */
  impersonatedBy?: string;
}

@Injectable()
export class SellerAuthGuard implements CanActivate {
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

    let payload: SellerTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_SELLER_SECRET'),
      ) as SellerTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }

    if (!payload.sub || !payload.roles?.includes('SELLER')) {
      throw new UnauthorizedAppException('Invalid seller token');
    }

    // Impersonation tokens have no real SellerSession row — skip session
    // check but still validate the seller account itself.
    const isImpersonation = !!payload.impersonatedBy;

    if (!isImpersonation) {
      if (!payload.sessionId) {
        throw new UnauthorizedAppException('Invalid token: missing session');
      }
      const session = await this.prisma.sellerSession.findUnique({
        where: { id: payload.sessionId },
        select: {
          id: true,
          revokedAt: true,
          expiresAt: true,
          sellerId: true,
        },
      });
      if (!session || session.sellerId !== payload.sub) {
        throw new UnauthorizedAppException('Session not found');
      }
      if (session.revokedAt) {
        throw new UnauthorizedAppException('Session has been revoked');
      }
      if (session.expiresAt < new Date()) {
        throw new UnauthorizedAppException('Session has expired');
      }
    }

    // Verify the seller account is still ACTIVE (or PENDING_APPROVAL, which
    // is the legacy state allowed by login-seller.use-case.ts).
    const seller = await this.prisma.seller.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, email: true, isDeleted: true },
    });
    if (!seller || seller.isDeleted) {
      throw new UnauthorizedAppException('Seller not found');
    }
    if (!['ACTIVE', 'PENDING_APPROVAL'].includes(seller.status)) {
      throw new UnauthorizedAppException('Seller account is not active');
    }

    request.sellerId = payload.sub;
    request.sellerEmail = seller.email;
    if (isImpersonation) {
      request.impersonatedBy = payload.impersonatedBy;
    } else {
      request.sessionId = payload.sessionId;
    }
    return true;
  }
}
