import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException, ForbiddenAppException } from '../../../../core/exceptions';
import { LoginResponseData } from '../../presentation/dtos/auth-response.dto';
import {
  UserRepository,
  USER_REPOSITORY,
} from '../../domain/repositories/user.repository';
import {
  SessionRepository,
  SESSION_REPOSITORY,
} from '../../domain/repositories/session.repository';

// Pre-hash a dummy password to use for timing attack prevention
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

interface LoginInput {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class LoginUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    @Inject(SESSION_REPOSITORY)
    private readonly sessionRepo: SessionRepository,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LoginUserUseCase');
  }

  async execute(input: LoginInput): Promise<LoginResponseData> {
    const { email, password, userAgent, ipAddress } = input;

    // Find user by email with roles
    const user = await this.userRepo.findByEmailWithRoles(email);

    if (!user) {
      // Timing attack prevention: still run bcrypt compare
      await bcrypt.compare(password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid email or password');
    }

    // Check user status
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenAppException('Account is not active. Please contact support.');
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedAppException('Invalid email or password');
    }

    // Extract roles
    const roles = user.roleAssignments.map((ra) => ra.role.name);

    // Create session
    const refreshToken = randomUUID();
    const refreshTtl = this.parseTimeToMs(this.envService.getString('JWT_REFRESH_TTL', '30d'));
    const expiresAt = new Date(Date.now() + refreshTtl);

    const session = await this.sessionRepo.createSession({
      userId: user.id,
      refreshToken,
      userAgent: userAgent || null,
      ipAddress: ipAddress || null,
      expiresAt,
    });

    // Generate access token
    const accessTtl = this.envService.getString('JWT_ACCESS_TTL', '7d');
    const accessTtlSeconds = this.parseTimeToSeconds(accessTtl);

    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        roles,
        sessionId: session.id,
      },
      this.envService.getString('JWT_ACCESS_SECRET'),
      { expiresIn: accessTtlSeconds },
    );

    // Emit event (fire and forget)
    this.eventBus.publish({
      eventName: 'identity.user.logged_in',
      aggregate: 'user',
      aggregateId: user.id,
      occurredAt: new Date(),
      payload: { userId: user.id, sessionId: session.id },
    }).catch((err) => {
      this.logger.error(`Failed to publish login event: ${err}`);
    });

    this.logger.log(`User logged in: ${user.id}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlSeconds,
      user: {
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
      },
    };
  }

  private parseTimeToMs(time: string): number {
    const match = time.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30 days
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
