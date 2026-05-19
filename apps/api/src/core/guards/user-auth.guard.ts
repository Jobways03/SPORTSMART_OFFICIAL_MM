import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { JWT_VERIFY_OPTIONS } from '../auth/jwt-constants';
import { readAccessCookie } from '../auth/auth-cookie.helper';
import { UnauthorizedAppException } from '../exceptions';

export interface UserTokenPayload {
  sub: string;
  email: string;
  roles: string[];
  sessionId: string;
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Follow-up #H40 — accept the token from EITHER source so the
    // migration from sessionStorage to httpOnly cookies can roll out
    // per-frontend. Bearer header wins when both are present so a
    // client mid-migration that still sends Bearer keeps working.
    const authHeader = request.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : undefined;
    const token = bearer ?? readAccessCookie(request, 'customer');

    if (!token) {
      throw new UnauthorizedAppException('Authentication required');
    }

    let payload: UserTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_CUSTOMER_SECRET'),
        JWT_VERIFY_OPTIONS,
      ) as UserTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }

    if (!payload.sub || !payload.roles?.includes('CUSTOMER')) {
      throw new UnauthorizedAppException('Invalid customer token');
    }

    // Verify the session has not been revoked. Stops a stolen JWT from
    // working after the customer logs out or is signed out remotely.
    if (!payload.sessionId) {
      throw new UnauthorizedAppException('Invalid token: missing session');
    }
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      select: { id: true, revokedAt: true, expiresAt: true, userId: true },
    });
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedAppException('Session not found');
    }
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedAppException('Session has expired');
    }

    // Verify the customer account is still ACTIVE.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, email: true },
    });
    if (!user) {
      throw new UnauthorizedAppException('User not found');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Account is not active');
    }

    request.userId = payload.sub;
    request.userEmail = user.email;
    request.sessionId = session.id;
    return true;
  }
}
