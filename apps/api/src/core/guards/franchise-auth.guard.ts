import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { UnauthorizedAppException } from '../exceptions';

export interface FranchiseTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  sessionId: string;
}

@Injectable()
export class FranchiseAuthGuard implements CanActivate {
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

    let payload: FranchiseTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_FRANCHISE_SECRET'),
      ) as FranchiseTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }

    if (!payload.sub || !payload.roles?.includes('FRANCHISE')) {
      throw new UnauthorizedAppException('Invalid franchise token');
    }

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
    request.sessionId = session.id;
    return true;
  }
}
