import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../bootstrap/env/env.service';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { JWT_VERIFY_OPTIONS } from '../auth/jwt-constants';
import { readAccessCookie } from '../auth/auth-cookie.helper';
import { UnauthorizedAppException } from '../exceptions';
import { resolveStaffPermissions } from '../../modules/franchise/application/auth/franchise-staff-permissions';

export interface FranchiseStaffTokenPayload {
  sub: string; // staff id
  franchiseId: string;
  email: string;
  roles: string[];
  staffRole: string;
  permissions: string[];
  sessionId: string;
}

/**
 * Phase 159u (staff-auth B1) — mirror of FranchiseAuthGuard for STAFF tokens.
 * Verifies the staff JWT, validates the FranchiseStaffSession, confirms the
 * staff is ACTIVE and the franchise is not suspended, and injects
 * req.staffId / franchiseId / staffRole / staffPermissions.
 */
@Injectable()
export class FranchiseStaffAuthGuard implements CanActivate {
  constructor(
    private readonly env: EnvService,
    private readonly prisma: PrismaService,
  ) {}

  private secret(): string {
    return (
      this.env.getString('JWT_FRANCHISE_STAFF_SECRET', '') ||
      this.env.getString('JWT_FRANCHISE_SECRET')
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    const bearer =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) || undefined : undefined;
    const token = bearer ?? readAccessCookie(request, 'franchise');
    if (!token) throw new UnauthorizedAppException('Authentication required');

    let payload: FranchiseStaffTokenPayload;
    try {
      payload = jwt.verify(token, this.secret(), JWT_VERIFY_OPTIONS) as FranchiseStaffTokenPayload;
    } catch {
      throw new UnauthorizedAppException('Invalid or expired token');
    }
    if (!payload.sub || !payload.roles?.includes('FRANCHISE_STAFF') || !payload.sessionId) {
      throw new UnauthorizedAppException('Invalid staff token');
    }

    const session = await this.prisma.franchiseStaffSession.findUnique({
      where: { id: payload.sessionId },
      select: { id: true, staffId: true, revokedAt: true, expiresAt: true },
    });
    if (!session || session.staffId !== payload.sub) {
      throw new UnauthorizedAppException('Session not found');
    }
    if (session.revokedAt) throw new UnauthorizedAppException('Session has been revoked');
    if (session.expiresAt < new Date()) throw new UnauthorizedAppException('Session has expired');

    const staff = await this.prisma.franchiseStaff.findUnique({
      where: { id: payload.sub },
      select: { id: true, franchiseId: true, status: true, role: true, permissions: true },
    });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Staff account is not active');
    }

    // Confirm the owning franchise is not suspended/deactivated.
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: staff.franchiseId },
      select: { status: true, isDeleted: true },
    });
    if (!franchise || franchise.isDeleted || ['SUSPENDED', 'DEACTIVATED'].includes(franchise.status)) {
      throw new UnauthorizedAppException('Franchise account is not active');
    }

    request.staffId = staff.id;
    request.franchiseId = staff.franchiseId;
    request.staffRole = staff.role;
    // Resolve from the LIVE staff row (role + overrides), not the token claim,
    // so an owner's permission/role edit takes effect on the next request
    // rather than only after the access token rotates.
    request.staffPermissions = resolveStaffPermissions(staff.role, staff.permissions);
    request.franchiseStatus = franchise.status;
    return true;
  }
}
