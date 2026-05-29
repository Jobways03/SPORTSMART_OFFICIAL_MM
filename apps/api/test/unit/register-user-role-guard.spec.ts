import 'reflect-metadata';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/repositories/prisma-user.prisma-repository';

/**
 * Regression test for the register-user role-assignment guard.
 *
 * Before: createUserWithRole silently no-op'd the role assignment
 * when the CUSTOMER role row was missing from the `roles` table
 * (`if (customerRole) { ... }`). That's how 6 customers ended up
 * without a CUSTOMER role assignment — registration must have run
 * before seed-admin had seeded the system roles. UserAuthGuard
 * requires `roles.includes('CUSTOMER')`, so these users received
 * an instant 401 on every authenticated request after login. From
 * the customer's perspective: logged in → auto-logged out.
 *
 * After: the guard throws inside the $transaction block when the
 * role is missing, so the user row is never created orphaned. The
 * error message points the operator at the fix (run seed:admin).
 *
 * Phase 16 (2026-05-20) — the transaction now also writes
 * ConsentRecord rows + an EmailVerificationOtp row inside the same
 * tx, so the guard test also asserts those tables are untouched
 * when the role lookup fails.
 */

describe('PrismaUserRepository.createUserWithRole — role guard', () => {
  const buildRepo = (opts: { customerRoleExists: boolean }) => {
    const tx = {
      user: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'u-1', email: 'a@b.com', firstName: 'A', lastName: 'B' }),
      },
      role: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.customerRoleExists
              ? { id: 'role-customer', name: 'CUSTOMER' }
              : null,
          ),
      },
      roleAssignment: { create: jest.fn().mockResolvedValue({}) },
      consentRecord: { create: jest.fn().mockResolvedValue({}) },
      emailVerificationOtp: {
        create: jest.fn().mockResolvedValue({ id: 'otp-1' }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const repo = new PrismaUserRepository(prisma);
    return { repo, tx, prisma };
  };

  const baseInput = {
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.com',
    passwordHash: 'hash',
    otpHash: 'otphash',
    otpExpiresAt: new Date(Date.now() + 600_000),
    consents: [
      { purpose: 'TERMS_OF_SERVICE', granted: true },
      { purpose: 'PRIVACY_POLICY', granted: true },
      { purpose: 'EMAIL_MARKETING', granted: false },
    ],
  };

  it('throws with a clear operator-facing message when CUSTOMER role is missing', async () => {
    const { repo } = buildRepo({ customerRoleExists: false });
    await expect(repo.createUserWithRole(baseInput)).rejects.toThrow(
      /CUSTOMER role missing.*seed:admin/i,
    );
  });

  it('does NOT create a User row, ConsentRecord, or OTP when the CUSTOMER role is missing (fail-fast inside tx)', async () => {
    const { repo, tx } = buildRepo({ customerRoleExists: false });
    await expect(repo.createUserWithRole(baseInput)).rejects.toThrow();

    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.roleAssignment.create).not.toHaveBeenCalled();
    expect(tx.consentRecord.create).not.toHaveBeenCalled();
    expect(tx.emailVerificationOtp.create).not.toHaveBeenCalled();
  });

  it('creates user + role assignment + consents + OTP when CUSTOMER role exists', async () => {
    const { repo, tx } = buildRepo({ customerRoleExists: true });
    const result = await repo.createUserWithRole(baseInput);

    expect(result).toEqual({
      id: 'u-1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      otpId: 'otp-1',
    });
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.user.create.mock.calls[0][0].data.status).toBe(
      'PENDING_VERIFICATION',
    );
    expect(tx.user.create.mock.calls[0][0].data.emailVerified).toBe(false);
    expect(tx.roleAssignment.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', roleId: 'role-customer' },
    });
    expect(tx.consentRecord.create).toHaveBeenCalledTimes(3);
    expect(tx.emailVerificationOtp.create).toHaveBeenCalledTimes(1);
    expect(tx.emailVerificationOtp.create.mock.calls[0][0].data).toMatchObject({
      userId: 'u-1',
      otpHash: 'otphash',
    });
  });

  it('returns null on duplicate-email collision (Prisma P2002) — no enumeration leak', async () => {
    const { repo, prisma } = buildRepo({ customerRoleExists: true });
    prisma.$transaction.mockRejectedValueOnce({
      code: 'P2002',
      meta: { target: ['email'] },
    });
    const result = await repo.createUserWithRole(baseInput);
    expect(result).toBeNull();
  });

  it('re-throws non-P2002 errors so the use case can decide policy', async () => {
    const { repo, prisma } = buildRepo({ customerRoleExists: true });
    prisma.$transaction.mockRejectedValueOnce(new Error('connection lost'));
    await expect(repo.createUserWithRole(baseInput)).rejects.toThrow(
      /connection lost/,
    );
  });
});
