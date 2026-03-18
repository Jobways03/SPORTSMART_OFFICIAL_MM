import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException, ForbiddenAppException } from '../../../../core/exceptions';

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
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminLoginUseCase');
  }

  async execute(input: AdminLoginInput): Promise<AdminLoginResult> {
    const { email, password, userAgent, ipAddress } = input;

    const admin = await this.prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!admin) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid credentials');
    }

    if (admin.status !== 'ACTIVE') {
      throw new ForbiddenAppException('Admin account is not active');
    }

    // Check lockout
    if (admin.lockUntil && admin.lockUntil > new Date()) {
      const remainingMinutes = Math.ceil((admin.lockUntil.getTime() - Date.now()) / 60000);
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

      await this.prisma.admin.update({
        where: { id: admin.id },
        data: updateData,
      });

      if (newAttempts >= MAX_FAILED_ATTEMPTS) {
        throw new UnauthorizedAppException(
          `Account locked due to too many failed attempts. Try again after ${LOCK_DURATION_MINUTES} minute(s).`,
        );
      }

      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Successful login
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: {
        failedLoginAttempts: 0,
        lockUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Create session
    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(this.envService.getString('JWT_REFRESH_TTL', '30d'));

    const session = await this.prisma.adminSession.create({
      data: {
        adminId: admin.id,
        refreshToken,
        userAgent: userAgent || null,
        ipAddress: ipAddress || null,
        expiresAt: new Date(Date.now() + refreshTtl),
      },
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
      this.envService.getString('JWT_ACCESS_SECRET'),
      { expiresIn: accessTtlSeconds },
    );

    this.logger.log(`Admin logged in: ${admin.id} (${admin.role})`);

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
