import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  ForbiddenAppException,
  UnauthorizedAppException,
} from '../../../../core/exceptions';

// Pre-hashed dummy hash so an unknown email doesn't short-circuit
// faster than a wrong password (timing-attack mitigation).
const DUMMY_HASH = '$2a$12$LJ3m4ys3Lg7VhMQdxlGC7.BQJ1HFpR9PQXHs1GKTTl1C5KVhJvtNi';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

@Injectable()
export class AffiliateAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envService: EnvService,
  ) {}

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();

    const affiliate = await this.prisma.affiliate.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        passwordHash: true,
        status: true,
        failedLoginAttempts: true,
        lockUntil: true,
      },
    });

    if (!affiliate) {
      // Constant-time fall-through to thwart account enumeration.
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw new UnauthorizedAppException('Invalid credentials');
    }

    if (affiliate.lockUntil && affiliate.lockUntil > new Date()) {
      throw new ForbiddenAppException(
        'Account temporarily locked due to too many failed attempts. Try again later.',
      );
    }

    // SRS §6.2 + §16.1: REJECTED + SUSPENDED can't log in. PENDING can
    // (so they can see their application status). INACTIVE can (so
    // they can see their balance + access support); they just can't
    // earn new commissions — enforced at order-attribution time.
    if (['REJECTED', 'SUSPENDED'].includes(affiliate.status)) {
      throw new ForbiddenAppException(
        'Your affiliate account is no longer active. Please contact support.',
      );
    }

    const ok = await bcrypt.compare(input.password, affiliate.passwordHash);
    if (!ok) {
      const next = affiliate.failedLoginAttempts + 1;
      await this.prisma.affiliate.update({
        where: { id: affiliate.id },
        data: {
          failedLoginAttempts: next,
          lockUntil:
            next >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000)
              : null,
        },
      });
      throw new UnauthorizedAppException('Invalid credentials');
    }

    // Reset counter on success.
    if (affiliate.failedLoginAttempts > 0 || affiliate.lockUntil) {
      await this.prisma.affiliate.update({
        where: { id: affiliate.id },
        data: { failedLoginAttempts: 0, lockUntil: null },
      });
    }

    const token = jwt.sign(
      {
        sub: affiliate.id,
        email: affiliate.email,
        roles: ['AFFILIATE'],
      },
      this.envService.getString('JWT_AFFILIATE_SECRET'),
      { expiresIn: '24h' },
    );

    return {
      token,
      affiliate: {
        id: affiliate.id,
        email: affiliate.email,
        firstName: affiliate.firstName,
        lastName: affiliate.lastName,
        status: affiliate.status,
      },
    };
  }
}
