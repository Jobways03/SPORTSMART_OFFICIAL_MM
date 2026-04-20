import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  AdminRepository,
  ADMIN_REPOSITORY,
} from '../../domain/repositories/admin.repository.interface';

const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

interface AdminLoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface AdminLoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  admin: {
    adminId: string;
    name: string;
    email: string;
    role: string;
  };
}

@Injectable()
export class AdminLoginUseCase {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
    private readonly audit: AuditPublicFacade,
  ) {
    this.logger.setContext('AdminLoginUseCase');
  }

  /** Audit-log helper — best-effort, never blocks the login flow. */
  private auditLogin(
    actorId: string | undefined,
    actorRole: string | undefined,
    action: 'ADMIN_LOGIN_SUCCESS' | 'ADMIN_LOGIN_FAILED' | 'ADMIN_LOGIN_BLOCKED',
    metadata: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string,
  ): void {
    this.audit
      .writeAuditLog({
        actorId,
        actorRole,
        action,
        module: 'admin',
        resource: 'admin_session',
        resourceId: actorId,
        metadata,
        ipAddress,
        userAgent,
      })
      .catch((err) => {
        this.logger.error(`Audit write failed: ${(err as Error).message}`);
      });
  }

  async execute(input: AdminLoginInput): Promise<AdminLoginResult> {
    const { email, password, userAgent, ipAddress } = input;

    const admin = await this.adminRepo.findAdminByEmail(email);

    if (!admin) {
      await bcrypt.compare(password, DUMMY_HASH);
      // Audit unknown-email failures so brute-force attempts surface in logs.
      this.auditLogin(
        undefined,
        undefined,
        'ADMIN_LOGIN_FAILED',
        { reason: 'unknown_email', email },
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedAppException('Invalid credentials');
    }

    if (admin.status !== 'ACTIVE') {
      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_BLOCKED',
        { reason: 'inactive_account', status: admin.status },
        ipAddress,
        userAgent,
      );
      throw new ForbiddenAppException('Admin account is not active');
    }

    // Check lockout
    if (admin.lockUntil && admin.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil((admin.lockUntil.getTime() - Date.now()) / 60000);
      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_BLOCKED',
        { reason: 'locked', lockUntil: admin.lockUntil.toISOString() },
        ipAddress,
        userAgent,
      );
      throw new UnauthorizedAppException(
        `Account locked. Try again after ${remainingMinutes} minute(s).`,
      );
    }

    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);

    if (!isPasswordValid) {
      const newAttempts = admin.failedLoginAttempts + 1;
      const updateData: Record<string, unknown> = { failedLoginAttempts: newAttempts };

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockUntil = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);
      }

      await this.adminRepo.updateAdmin(admin.id, updateData);

      this.auditLogin(
        admin.id,
        admin.role,
        'ADMIN_LOGIN_FAILED',
        { reason: 'wrong_password', attempts: newAttempts },
        ipAddress,
        userAgent,
      );

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        throw new UnauthorizedAppException(
          `Account locked due to too many failed attempts. Try again after ${LOCK_DURATION_MINUTES} minute(s).`,
        );
      }

      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Successful login
    await this.adminRepo.updateAdmin(admin.id, {
      failedLoginAttempts: 0,
      lockUntil: null,
      lastLoginAt: new Date(),
    });

    // Create session
    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(this.envService.getString('JWT_REFRESH_TTL', '30d'));

    const session = await this.adminRepo.createAdminSession({
      adminId: admin.id,
      refreshToken,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
      expiresAt: new Date(Date.now() + refreshTtl),
    });

    // Generate access token
    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '7d');
    const accessTtlSeconds = Math.floor(this.parseTimeToMs(accessTtl) / 1000);

    const accessToken = jwt.sign(
      {
        sub: admin.id,
        email: admin.email,
        role: admin.role,
        sessionId: session.id,
      },
      this.envService.getString('JWT_ADMIN_SECRET'),
      { expiresIn: accessTtlSeconds },
    );

    this.logger.log(`Admin logged in: ${admin.id} (${admin.role})`);

    this.auditLogin(
      admin.id,
      admin.role,
      'ADMIN_LOGIN_SUCCESS',
      { sessionId: session.id },
      ipAddress,
      userAgent,
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      admin: {
        adminId: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    };
  }

  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }
}
