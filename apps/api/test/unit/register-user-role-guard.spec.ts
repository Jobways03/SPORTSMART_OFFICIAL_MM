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
 */

describe('PrismaUserRepository.createUserWithRole — role guard', () => {
  const buildRepo = (opts: { customerRoleExists: boolean }) => {
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'u-1' }) },
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
    };
    const prisma: any = {
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const repo = new PrismaUserRepository(prisma);
    return { repo, tx, prisma };
  };

  const input = {
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.com',
    passwordHash: 'hash',
  };

  it('throws with a clear operator-facing message when CUSTOMER role is missing', async () => {
    const { repo } = buildRepo({ customerRoleExists: false });
    await expect(repo.createUserWithRole(input)).rejects.toThrow(
      /CUSTOMER role missing.*seed:admin/i,
    );
  });

  it('does NOT create a User row when the CUSTOMER role is missing (fail-fast inside tx)', async () => {
    const { repo, tx } = buildRepo({ customerRoleExists: false });
    await expect(repo.createUserWithRole(input)).rejects.toThrow();

    // The whole point: no orphan User row. user.create must not have
    // been called before the role guard threw.
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.roleAssignment.create).not.toHaveBeenCalled();
  });

  it('creates user + role assignment when CUSTOMER role exists', async () => {
    const { repo, tx } = buildRepo({ customerRoleExists: true });
    await repo.createUserWithRole(input);

    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.roleAssignment.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', roleId: 'role-customer' },
    });
  });
});
