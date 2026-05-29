import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { JWT_ALGORITHM } from '../../../../core/auth/jwt-constants';
import {
  UnauthorizedAppException,
  BadRequestAppException,
} from '../../../../core/exceptions';
import { resolveStaffPermissions } from './franchise-staff-permissions';
import { hashToken, newRefreshToken } from './franchise-staff-token.util';

// Timing-attack guard: compare against a real bcrypt hash when the staff /
// password is absent so the failure path costs the same as the success path.
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

@Injectable()
export class FranchiseStaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('FranchiseStaffAuthService');
  }

  private staffSecret(): string {
    // Dedicated staff secret if configured, else the franchise secret. Staff
    // tokens are still isolated from owner tokens by the roles claim
    // (FRANCHISE_STAFF vs FRANCHISE) + the separate session table + guard.
    return (
      this.env.getString('JWT_FRANCHISE_STAFF_SECRET', '') ||
      this.env.getString('JWT_FRANCHISE_SECRET')
    );
  }

  private parseTimeToMs(time: string): number {
    const m = time.match(/^(\d+)(s|m|h|d)$/);
    if (!m) return 30 * 24 * 60 * 60 * 1000;
    const mult: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return parseInt(m[1]!, 10) * (mult[m[2]!] || 1000);
  }

  /**
   * B4 — set the password from an invitation token. INVITED → ACTIVE.
   */
  async activate(token: string, password: string) {
    const staff = await this.prisma.franchiseStaff.findFirst({
      where: { inviteTokenHash: hashToken(token), status: 'INVITED' },
    });
    if (!staff || !staff.inviteExpiresAt || staff.inviteExpiresAt < new Date()) {
      throw new BadRequestAppException('Invalid or expired invitation');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.franchiseStaff.update({
      where: { id: staff.id },
      data: {
        passwordHash,
        status: 'ACTIVE',
        isActive: true,
        inviteTokenHash: null,
        inviteExpiresAt: null,
      },
    });
    this.logger.log(`Staff ${staff.id} activated`);
    return { activated: true };
  }

  /**
   * B1 — staff login. Disambiguated by franchiseCode (email is per-franchise),
   * issues an access JWT + refresh session.
   */
  async login(input: {
    franchiseCode: string;
    email: string;
    password: string;
    userAgent?: string | null;
    ipAddress?: string | null;
  }) {
    const franchise = await this.prisma.franchisePartner.findFirst({
      where: { franchiseCode: input.franchiseCode },
      select: { id: true, status: true, isDeleted: true },
    });
    const staff = franchise
      ? await this.prisma.franchiseStaff.findFirst({
          where: { franchiseId: franchise.id, email: input.email.toLowerCase() },
        })
      : null;

    // Uniform failure for missing franchise/staff or wrong password.
    if (!franchise || franchise.isDeleted || !staff || !staff.passwordHash) {
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid credentials');
    }
    if (['SUSPENDED', 'DEACTIVATED'].includes(franchise.status)) {
      throw new UnauthorizedAppException('Franchise account is not active');
    }
    if (staff.status !== 'ACTIVE') {
      // INVITED / SUSPENDED / TERMINATED cannot log in.
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid credentials');
    }

    const ok = await bcrypt.compare(input.password, staff.passwordHash);
    if (!ok) throw new UnauthorizedAppException('Invalid credentials');

    const permissions = resolveStaffPermissions(staff.role, staff.permissions);

    // Refresh session (store only the hash).
    const refresh = newRefreshToken();
    const refreshTtl = this.parseTimeToMs(this.env.getString('JWT_REFRESH_TTL', '30d'));
    const session = await this.prisma.franchiseStaffSession.create({
      data: {
        staffId: staff.id,
        refreshToken: refresh.hash,
        userAgent: input.userAgent ?? null,
        ipAddress: input.ipAddress ?? null,
        expiresAt: new Date(Date.now() + refreshTtl),
      },
    });

    await this.prisma.franchiseStaff.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    const accessTtlSeconds = Math.floor(
      this.parseTimeToMs(this.env.getString('JWT_ACCESS_TTL', '1h')) / 1000,
    );
    const accessToken = jwt.sign(
      {
        sub: staff.id,
        franchiseId: staff.franchiseId,
        email: staff.email,
        roles: ['FRANCHISE_STAFF'],
        staffRole: staff.role,
        permissions,
        sessionId: session.id,
      },
      this.staffSecret(),
      { expiresIn: accessTtlSeconds, algorithm: JWT_ALGORITHM },
    );

    this.logger.log(`Staff logged in: ${staff.id} (franchise ${staff.franchiseId})`);
    return {
      accessToken,
      refreshToken: refresh.raw,
      expiresIn: accessTtlSeconds,
      staff: {
        id: staff.id,
        franchiseId: staff.franchiseId,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        permissions,
      },
    };
  }

  /**
   * B1 — rotate the refresh session + mint a fresh access token.
   */
  async refresh(rawRefreshToken: string) {
    if (!rawRefreshToken) throw new UnauthorizedAppException('Refresh token required');
    const session = await this.prisma.franchiseStaffSession.findFirst({
      where: { refreshToken: hashToken(rawRefreshToken) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedAppException('Invalid or expired session');
    }
    const staff = await this.prisma.franchiseStaff.findUnique({ where: { id: session.staffId } });
    if (!staff || staff.status !== 'ACTIVE') {
      throw new UnauthorizedAppException('Staff account is not active');
    }

    const rotated = newRefreshToken();
    await this.prisma.franchiseStaffSession.update({
      where: { id: session.id },
      data: { refreshToken: rotated.hash, lastUsedAt: new Date() },
    });

    const permissions = resolveStaffPermissions(staff.role, staff.permissions);
    const accessTtlSeconds = Math.floor(
      this.parseTimeToMs(this.env.getString('JWT_ACCESS_TTL', '1h')) / 1000,
    );
    const accessToken = jwt.sign(
      {
        sub: staff.id,
        franchiseId: staff.franchiseId,
        email: staff.email,
        roles: ['FRANCHISE_STAFF'],
        staffRole: staff.role,
        permissions,
        sessionId: session.id,
      },
      this.staffSecret(),
      { expiresIn: accessTtlSeconds, algorithm: JWT_ALGORITHM },
    );
    return { accessToken, refreshToken: rotated.raw, expiresIn: accessTtlSeconds };
  }

  /** B1 — logout: revoke the session(s) for this staff. */
  async logout(staffId: string) {
    await this.revokeAllSessions(staffId, 'logout');
  }

  /**
   * Revoke every active session for a staff member — called on logout and by
   * the staff service on suspend/terminate so a fired cashier's token dies.
   */
  async revokeAllSessions(staffId: string, _reason?: string): Promise<number> {
    const res = await this.prisma.franchiseStaffSession.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }
}
