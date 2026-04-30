import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { UnauthorizedAppException } from '../exceptions';

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  sessionId: string;
}

const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'SELLER_ADMIN',
  'SELLER_SUPPORT',
  'SELLER_OPERATIONS',
  'AFFILIATE_ADMIN',
];

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly envService: EnvService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedAppException('Admin authentication required');
    }

    const token = authHeader.slice(7);

    let payload: AdminTokenPayload;
    try {
      payload = jwt.verify(
        token,
        this.envService.getString('JWT_ADMIN_SECRET'),
      ) as AdminTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired admin token');
    }

    if (!payload.sub || !payload.role) {
      throw new UnauthorizedAppException('Invalid admin token');
    }
    if (!ADMIN_ROLES.includes(payload.role)) {
      throw new UnauthorizedAppException('Not an admin token');
    }

    if (!payload.sessionId) {
      throw new UnauthorizedAppException('Invalid token: missing session');
    }
    const session = await this.prisma.adminSession.findUnique({
      where: { id: payload.sessionId },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        adminId: true,
      },
    });
    if (!session || session.adminId !== payload.sub) {
      throw new UnauthorizedAppException('Session not found');
    }
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedAppException('Session has expired');
    }

    // Verify the admin account is still ACTIVE and the role hasn't been
    // downgraded since the token was issued — re-check role from DB.
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, email: true, role: true },
    });
    if (!admin) {
      throw new UnauthorizedAppException('Admin not found');
    }
    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Admin account is not active');
    }
    if (admin.role !== payload.role) {
      throw new UnauthorizedAppException('Admin role has changed — please log in again');
    }

    request.adminId = payload.sub;
    request.adminEmail = admin.email;
    request.adminRole = admin.role;
    request.sessionId = session.id;
    // Populate the standard shape that RolesGuard expects so @Roles()
    // works on admin routes without each controller re-reading adminRole.
    request.user = {
      id: payload.sub,
      roles: [admin.role],
    };
    return true;
  }
}
