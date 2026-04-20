import { Inject, Injectable } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  UnauthorizedAppException,
  ForbiddenAppException,
} from '../../../../core/exceptions';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';
import {
  SessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository';

export interface RefreshSessionInput {
  refreshToken: string;
}

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class RefreshSessionUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepo: SessionRepository,
    private readonly envService: EnvService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('RefreshSessionUseCase');
  }

  async execute(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const { refreshToken } = input;

    if (!refreshToken) {
      throw new UnauthorizedAppException('Refresh token is required');
    }

    // Look up the session by refresh token
    const session = await this.sessionRepo.findByRefreshToken(refreshToken);
    if (!session) {
      throw new UnauthorizedAppException('Invalid refresh token');
    }

    // Verify the session is not revoked or expired
    if (session.revokedAt) {
      throw new UnauthorizedAppException('Session has been revoked');
    }
    if (session.expiresAt < new Date()) {
      throw new UnauthorizedAppException('Refresh token expired');
    }

    // Look up the user with current roles (roles may have changed since login)
    const user = (await this.userRepo.findById(session.userId)) as any;
    if (!user) {
      // User was deleted — revoke the session and reject
      await this.sessionRepo.revoke(session.id);
      throw new UnauthorizedAppException('User not found');
    }

    if (user.status !== 'ACTIVE') {
      await this.sessionRepo.revoke(session.id);
      throw new ForbiddenAppException(
        'Account is not active. Please contact support.',
      );
    }

    const roles: string[] = (user.roleAssignments || []).map(
      (ra: any) => ra.role.name,
    );

    // Rotate the refresh token (best practice — limits exposure window)
    const newRefreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(
      this.envService.getString('JWT_REFRESH_TTL', '30d'),
    );
    const newExpiresAt = new Date(Date.now() + refreshTtl);
    await this.sessionRepo.rotateRefreshToken(
      session.id,
      newRefreshToken,
      newExpiresAt,
    );

    // Issue a new access token
    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '7d');
    const accessTtlSeconds = this.parseTimeToSeconds(accessTtl);

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        roles,
        sessionId: session.id,
      },
      this.envService.getString('JWT_CUSTOMER_SECRET'),
      { expiresIn: accessTtlSeconds },
    );

    this.logger.log(`Session refreshed for user: ${user.id}`);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: accessTtlSeconds,
    };
  }

  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * (multipliers[unit] || 1000);
  }

  private parseTimeToSeconds(time: string): number {
    return Math.floor(this.parseTimeToMs(time) / 1000);
  }
}
