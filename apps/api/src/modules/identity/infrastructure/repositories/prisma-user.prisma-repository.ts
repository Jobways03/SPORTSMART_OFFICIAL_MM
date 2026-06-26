import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  UserRepository,
  UserWithRoles,
  PasswordResetOtpRecord,
  EmailVerificationOtpRecord,
  CustomerProfile,
  CustomerProfileWithPassword,
  UpdateCustomerProfileInput,
  RegistrationConsentInput,
} from '../../domain/repositories/user.repository';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { roleAssignments: { include: { role: true } } },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: { roleAssignments: { include: { role: true } } },
    });
  }

  async findByEmailWithRoles(email: string): Promise<UserWithRoles | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        roleAssignments: {
          include: { role: true },
        },
      },
    }) as Promise<UserWithRoles | null>;
  }

  async save(_user: unknown): Promise<void> {
    // Generic save - not used in current use-cases but kept for interface compliance
  }

  // ── Customer profile self-service ──────────────────────────

  async findCustomerProfile(id: string): Promise<CustomerProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        emailVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return user as CustomerProfile | null;
  }

  async findCustomerProfileWithPassword(
    id: string,
  ): Promise<CustomerProfileWithPassword | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        emailVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        passwordHash: true,
      },
    });
    return user as CustomerProfileWithPassword | null;
  }

  async updateCustomerProfile(
    id: string,
    data: UpdateCustomerProfileInput,
  ): Promise<CustomerProfile> {
    // If email is changing, mark as unverified again. Phase 27
    // (2026-05-21) — phoneVerified column dropped; phone-change
    // no longer needs to reset a verification flag since the
    // platform doesn't gate any flow on phone verification.
    //
    // Only reset emailVerified when the email ACTUALLY changes. The client
    // sends the (unchanged) email on every profile save — e.g. a phone-only
    // edit — so resetting on `email !== undefined` alone spuriously
    // un-verifies a previously-verified email. Compare against the stored
    // value (trimmed, case-insensitive) and reset only on a real change.
    const updates: any = { ...data };
    if (data.email !== undefined) {
      const current = await this.prisma.user.findUnique({
        where: { id },
        select: { email: true },
      });
      const emailChanged =
        !current ||
        (current.email ?? '').trim().toLowerCase() !==
          data.email.trim().toLowerCase();
      if (emailChanged) {
        updates.emailVerified = false;
      }
    }
    const user = await this.prisma.user.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        emailVerified: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return user as CustomerProfile;
  }

  async existsByEmailExcept(email: string, excludeUserId: string): Promise<boolean> {
    const found = await this.prisma.user.findFirst({
      where: { email, id: { not: excludeUserId } },
      select: { id: true },
    });
    return !!found;
  }

  async existsByPhoneExcept(phone: string, excludeUserId: string): Promise<boolean> {
    const found = await this.prisma.user.findFirst({
      where: { phone, id: { not: excludeUserId } },
      select: { id: true },
    });
    return !!found;
  }

  async changePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        // Clear the lockout counter too so the user is never stuck
        // locked-out after a self-service password change.
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async recordFailedLogin(
    userId: string,
    attempts: number,
    lockUntil: Date | null,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: attempts, lockUntil },
    });
  }

  /**
   * Phase 17 (2026-05-20) — atomic failed-login increment.
   *
   * The earlier read-then-set lost concurrent increments: two parallel
   * wrong passwords both saw `failedLoginAttempts = N`, both computed
   * `N+1`, both wrote `N+1` — the count stayed at N+1 instead of N+2,
   * so the 5-attempt lockout effectively took 10+ attempts under
   * contention. This variant:
   *
   *   1. Issues a single UPDATE with `{ increment: 1 }` so the DB
   *      serialises the bump.
   *   2. Reads the post-increment count from the same row (Prisma's
   *      `update` returns the new value).
   *   3. If the count crossed `maxAttempts`, performs a follow-up
   *      update to stamp `lockUntil`. Two-write is fine: in the worst
   *      case two parallel callers both observe "exceeded" and both
   *      stamp a similar time-window — idempotent at the column.
   */
  async recordFailedLoginAtomic(
    userId: string,
    maxAttempts: number,
    lockDurationMs: number,
  ): Promise<{ failedLoginAttempts: number; lockUntil: Date | null }> {
    const after = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    const failedLoginAttempts = after.failedLoginAttempts;

    if (failedLoginAttempts >= maxAttempts) {
      const lockUntil = new Date(Date.now() + lockDurationMs);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockUntil },
      });
      return { failedLoginAttempts, lockUntil };
    }
    return { failedLoginAttempts, lockUntil: null };
  }

  async clearLoginLockout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockUntil: null },
    });
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  }

  // ── Registration ───────────────────────────────────────────

  async createUserWithRole(data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
    otpHash: string;
    otpExpiresAt: Date;
    consents: RegistrationConsentInput[];
  }): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    otpId: string;
  } | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Resolve CUSTOMER role first — if it's missing, fail the whole
        // transaction so we never create an orphan user without a role.
        // The prior silent `if (customerRole)` swallow is how 6 customers
        // ended up un-login-able: registration ran before seed-admin had
        // inserted the system roles, so the role lookup returned null and
        // the create was skipped. UserAuthGuard requires
        // roles.includes('CUSTOMER'); an un-roled user = instant 401 on
        // every subsequent request.
        const customerRole = await tx.role.findUnique({
          where: { name: 'CUSTOMER' },
        });
        if (!customerRole) {
          throw new Error(
            'CUSTOMER role missing from database — run `pnpm run seed:admin` to provision system roles before registering users.',
          );
        }

        const newUser = await tx.user.create({
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            // Phase 21 (2026-05-20) — phone is optional at registration
            // (India e-commerce expects it for COD + delivery). The
            // schema column is @unique nullable; Postgres ignores null
            // duplicates, so two phone-less rows are still legal. A
            // collision on a populated phone surfaces as P2002 below
            // and is collapsed into the uniform duplicate-email path.
            phone: data.phone ?? null,
            passwordHash: data.passwordHash,
            // Phase 16 (2026-05-20) — new customers are inactive until
            // OTP verification. LoginUserUseCase refuses to sign tokens
            // for users in PENDING_VERIFICATION; the verify use-case
            // flips the row to ACTIVE inside the same transaction that
            // marks the OTP consumed.
            status: 'PENDING_VERIFICATION',
            emailVerified: false,
          },
        });

        await tx.roleAssignment.create({
          data: {
            userId: newUser.id,
            roleId: customerRole.id,
          },
        });

        // DPDP §6 — store the customer's consent choices for each
        // purpose presented at registration. The audit row (legal
        // record) is written by the use-case after the transaction
        // commits; this is the indexed projection used by marketing
        // dispatchers + the privacy page.
        //
        // Phase 28 (2026-05-21) — every row pins consent_version so a
        // DPDP audit can answer "what notice did the user agree to?"
        for (const consent of data.consents) {
          await tx.consentRecord.create({
            data: {
              userId: newUser.id,
              purpose: consent.purpose,
              granted: consent.granted,
              consentVersion: consent.consentVersion,
              source: consent.source ?? 'register-form',
              ipAddress: consent.ipAddress ?? null,
              userAgent: consent.userAgent ?? null,
            },
          });
        }

        // OTP row — SHA-256 hash, 10-minute TTL. Creating the row
        // inside the same transaction means a registration with no
        // verification OTP is unreachable; the registration is the
        // atomic unit.
        const otp = await tx.emailVerificationOtp.create({
          data: {
            userId: newUser.id,
            otpHash: data.otpHash,
            expiresAt: data.otpExpiresAt,
          },
        });

        return {
          id: newUser.id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          otpId: otp.id,
        };
      });
    } catch (error: any) {
      // Duplicate-email collision: return null so the use-case can
      // emit a uniform "check your inbox" response instead of leaking
      // account existence to an enumeration attacker.
      if (error?.code === 'P2002' && error?.meta?.target?.includes('email')) {
        return null;
      }
      throw error;
    }
  }

  // ── External identity ("Sign in with Google") ─────────────

  async findUserByAuthIdentity(
    provider: string,
    providerSubject: string,
  ): Promise<UserWithRoles | null> {
    const identity = await this.prisma.authIdentity.findUnique({
      // Compound @@unique([provider, providerSubject]) — Prisma names the
      // composite input `provider_providerSubject`.
      where: { provider_providerSubject: { provider, providerSubject } },
      include: {
        user: {
          include: { roleAssignments: { include: { role: true } } },
        },
      },
    });
    return (identity?.user ?? null) as UserWithRoles | null;
  }

  async linkGoogleIdentityAndActivate(params: {
    userId: string;
    providerSubject: string;
    providerEmail: string;
  }): Promise<UserWithRoles> {
    return this.prisma.$transaction(async (tx) => {
      await tx.authIdentity.create({
        data: {
          userId: params.userId,
          provider: 'google',
          providerSubject: params.providerSubject,
          email: params.providerEmail,
          emailVerifiedByProvider: true,
        },
      });

      // Google proved the user controls the matched email — the same
      // assurance the OTP flow gives — so ensure the account is ACTIVE +
      // emailVerified. Preserve an existing emailVerifiedAt (don't rewrite
      // the original verification moment); only stamp it when first set.
      const current = await tx.user.findUnique({
        where: { id: params.userId },
        select: { status: true, emailVerifiedAt: true },
      });

      const user = await tx.user.update({
        where: { id: params.userId },
        data: {
          status:
            current?.status === 'PENDING_VERIFICATION'
              ? 'ACTIVE'
              : current?.status,
          emailVerified: true,
          emailVerifiedAt: current?.emailVerifiedAt ?? new Date(),
        },
        include: { roleAssignments: { include: { role: true } } },
      });
      return user as unknown as UserWithRoles;
    });
  }

  async createGoogleCustomer(params: {
    firstName: string;
    lastName: string;
    email: string;
    providerSubject: string;
    providerEmail: string;
    consents: RegistrationConsentInput[];
  }): Promise<UserWithRoles | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Same invariant as createUserWithRole: a missing CUSTOMER role
        // fails the whole transaction so we never create an un-roled user
        // (UserAuthGuard requires roles.includes('CUSTOMER')).
        const customerRole = await tx.role.findUnique({
          where: { name: 'CUSTOMER' },
        });
        if (!customerRole) {
          throw new Error(
            'CUSTOMER role missing from database — run `pnpm run seed:admin` to provision system roles before Google sign-in.',
          );
        }

        const newUser = await tx.user.create({
          data: {
            firstName: params.firstName,
            lastName: params.lastName,
            email: params.email,
            // OAuth-only account: no password is ever set. Login must
            // 401 on the null-hash path (see LoginUserUseCase).
            passwordHash: null,
            // Google asserted a verified email, so the account is active
            // and verified immediately (decision: AUTO-CREATE as ACTIVE).
            status: 'ACTIVE',
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });

        await tx.roleAssignment.create({
          data: { userId: newUser.id, roleId: customerRole.id },
        });

        await tx.authIdentity.create({
          data: {
            userId: newUser.id,
            provider: 'google',
            providerSubject: params.providerSubject,
            email: params.providerEmail,
            emailVerifiedByProvider: true,
          },
        });

        // DPDP §6 — record the consent choices presented alongside the
        // Google button (source 'google-oauth'), mirroring the rows the
        // register flow writes.
        for (const consent of params.consents) {
          await tx.consentRecord.create({
            data: {
              userId: newUser.id,
              purpose: consent.purpose,
              granted: consent.granted,
              consentVersion: consent.consentVersion,
              source: consent.source ?? 'google-oauth',
              ipAddress: consent.ipAddress ?? null,
              userAgent: consent.userAgent ?? null,
            },
          });
        }

        const withRoles = await tx.user.findUnique({
          where: { id: newUser.id },
          include: { roleAssignments: { include: { role: true } } },
        });
        return withRoles as unknown as UserWithRoles;
      });
    } catch (error: any) {
      // P2002 race: a concurrent Google login created the same email
      // (users.email unique) or linked the same subject
      // (auth_identities.provider+providerSubject unique) first. Return
      // null so the use-case recovers by re-querying.
      if (error?.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  // ── Email-verification OTP operations ─────────────────────

  async findByEmailForVerification(email: string): Promise<{
    id: string;
    email: string;
    status: string;
    emailVerified: boolean;
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        status: true,
        emailVerified: true,
      },
    });
    return user as unknown as
      | { id: string; email: string; status: string; emailVerified: boolean }
      | null;
  }

  async createEmailVerificationOtp(
    userId: string,
    otpHash: string,
    expiresAt: Date,
  ): Promise<{ id: string }> {
    const otp = await this.prisma.emailVerificationOtp.create({
      data: { userId, otpHash, expiresAt },
      select: { id: true },
    });
    return otp;
  }

  async findActiveEmailVerificationOtp(
    userId: string,
  ): Promise<EmailVerificationOtpRecord | null> {
    return this.prisma.emailVerificationOtp.findFirst({
      where: {
        userId,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<EmailVerificationOtpRecord | null>;
  }

  async findRecentEmailVerificationOtp(
    userId: string,
    cooldownSeconds: number,
  ): Promise<EmailVerificationOtpRecord | null> {
    return this.prisma.emailVerificationOtp.findFirst({
      where: {
        userId,
        verifiedAt: null,
        createdAt: {
          gte: new Date(Date.now() - cooldownSeconds * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<EmailVerificationOtpRecord | null>;
  }

  /**
   * Phase 27 (2026-05-21) — counts EmailVerificationOtp rows created
   * since a given timestamp. Powers the hourly resend cap on the
   * resend-verification-otp use case (parallel to the password-reset
   * countOtpsSince added Phase 26, but querying the separate
   * email_verification_otps table).
   */
  async countEmailVerificationOtpsSince(
    userId: string,
    since: Date,
  ): Promise<number> {
    return this.prisma.emailVerificationOtp.count({
      where: { userId, createdAt: { gte: since } },
    });
  }

  async invalidateActiveEmailVerificationOtps(userId: string): Promise<void> {
    // Mirrors PasswordResetOtp.invalidateActiveOtps: set expiresAt to
    // now() on every still-active row, so the verify use-case's
    // "active OTP" lookup misses on them.
    await this.prisma.emailVerificationOtp.updateMany({
      where: {
        userId,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { expiresAt: new Date() },
    });
  }

  async expireEmailVerificationOtp(otpId: string): Promise<void> {
    await this.prisma.emailVerificationOtp.update({
      where: { id: otpId },
      data: { expiresAt: new Date() },
    });
  }

  async incrementEmailVerificationOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }> {
    // Atomic CAS — the WHERE expresses "still active AND below cap"
    // so concurrent verifies cannot both pass.
    const res = await this.prisma.emailVerificationOtp.updateMany({
      where: {
        id: otpId,
        attempts: { lt: maxAttempts },
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (res.count !== 1) return { ok: false };
    const after = await this.prisma.emailVerificationOtp.findUnique({
      where: { id: otpId },
      select: { attempts: true },
    });
    return { ok: true, attempts: after?.attempts ?? 0 };
  }

  async markEmailVerified(otpId: string, userId: string): Promise<void> {
    // Atomic: OTP consumed + user activated. Either both land or
    // neither does. A crash mid-transaction never leaves a user
    // with a consumed OTP but no ACTIVE status.
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.emailVerificationOtp.update({
        where: { id: otpId },
        data: { verifiedAt: now },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'ACTIVE',
          emailVerified: true,
          emailVerifiedAt: now,
        },
      });
    });
  }

  // ── Password update ────────────────────────────────────────

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  // ── OTP operations ─────────────────────────────────────────

  async findRecentOtp(userId: string, cooldownSeconds: number): Promise<PasswordResetOtpRecord | null> {
    return this.prisma.passwordResetOtp.findFirst({
      where: {
        userId,
        usedAt: null,
        createdAt: {
          gte: new Date(Date.now() - cooldownSeconds * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<PasswordResetOtpRecord | null>;
  }

  /**
   * Phase 26 (2026-05-20) — count OTPs created since `since`. Used by
   * the resend-OTP use case to enforce the per-account hourly cap
   * (mirror of countOtpsSince in seller / franchise repos).
   */
  async countOtpsSince(userId: string, since: Date): Promise<number> {
    return this.prisma.passwordResetOtp.count({
      where: { userId, createdAt: { gte: since } },
    });
  }

  async findActiveOtp(userId: string): Promise<PasswordResetOtpRecord | null> {
    return this.prisma.passwordResetOtp.findFirst({
      where: {
        userId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    }) as Promise<PasswordResetOtpRecord | null>;
  }

  async invalidateActiveOtps(userId: string): Promise<void> {
    await this.prisma.passwordResetOtp.updateMany({
      where: {
        userId,
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { expiresAt: new Date() },
    });
  }

  async createOtp(userId: string, otpHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.passwordResetOtp.create({
      data: {
        userId,
        otpHash,
        expiresAt,
      },
    });
  }

  async incrementOtpAttempts(otpId: string): Promise<void> {
    await this.prisma.passwordResetOtp.update({
      where: { id: otpId },
      data: { attempts: { increment: 1 } },
    });
  }

  /**
   * Phase 1 / H5 — atomic CAS increment. Returns the post-increment
   * attempts count if the row was updated (attempts < maxAttempts at
   * the moment of the increment), or null if the cap was already
   * reached. Replaces the read-then-increment pattern in
   * verify-reset-otp.use-case which two concurrent verifies could
   * both pass.
   *
   * Implemented via updateMany so the WHERE clause expresses the
   * "below cap" predicate atomically; updateMany returns `count` so
   * the caller can tell whether the row was eligible. A follow-up
   * findUnique fetches the new attempts value.
   */
  async incrementOtpAttemptsCas(
    otpId: string,
    maxAttempts: number,
  ): Promise<{ ok: true; attempts: number } | { ok: false }> {
    const res = await this.prisma.passwordResetOtp.updateMany({
      where: {
        id: otpId,
        attempts: { lt: maxAttempts },
        usedAt: null,
        verifiedAt: null,
        expiresAt: { gte: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (res.count !== 1) return { ok: false };
    const after = await this.prisma.passwordResetOtp.findUnique({
      where: { id: otpId },
      select: { attempts: true },
    });
    return { ok: true, attempts: after?.attempts ?? 0 };
  }

  async expireOtp(otpId: string): Promise<void> {
    await this.prisma.passwordResetOtp.update({
      where: { id: otpId },
      data: { expiresAt: new Date() },
    });
  }

  async markOtpVerified(otpId: string, resetToken: string): Promise<void> {
    await this.prisma.passwordResetOtp.update({
      where: { id: otpId },
      data: {
        verifiedAt: new Date(),
        resetToken,
      },
    });
  }

  async findOtpByResetToken(resetToken: string): Promise<PasswordResetOtpRecord | null> {
    return this.prisma.passwordResetOtp.findUnique({
      where: { resetToken },
      include: { user: true },
    }) as unknown as PasswordResetOtpRecord | null;
  }

  // ── Reset password transaction ─────────────────────────────

  async resetPasswordTransaction(params: {
    userId: string;
    passwordHash: string;
    otpId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: params.userId },
        data: {
          passwordHash: params.passwordHash,
          // Clear lockout so a previously locked-out user can log in
          // immediately with the new password.
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });

      await tx.passwordResetOtp.update({
        where: { id: params.otpId },
        data: { usedAt: new Date() },
      });

      // Revoke all active sessions for this user
      await tx.session.updateMany({
        where: {
          userId: params.userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });
  }

  // ── Role/permission queries ────────────────────────────────

  async getUserRoles(userId: string): Promise<string[]> {
    const assignments = await this.prisma.roleAssignment.findMany({
      where: { userId },
      include: { role: true },
    });
    return assignments.map((a) => a.role.name);
  }

  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const count = await this.prisma.rolePermission.count({
      where: {
        role: { assignments: { some: { userId } } },
        permission: { code: permissionCode },
      },
    });
    return count > 0;
  }
}
