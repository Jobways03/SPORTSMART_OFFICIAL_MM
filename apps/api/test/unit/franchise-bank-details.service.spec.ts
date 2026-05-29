import 'reflect-metadata';
import { FranchiseBankDetailsService } from '../../src/modules/franchise/application/services/franchise-bank-details.service';

/**
 * Phase 20 (2026-05-20) — FranchiseBankDetailsService unit tests.
 *
 * Mirrors SellerBankDetailsService coverage. Verifies:
 *   • Encryption round-trip (encrypt → decrypt yields original).
 *   • Validation rejects bad IFSC / account number / UPI VPA / short name.
 *   • Missing key surfaces BANK_DETAILS_UNAVAILABLE rather than silently
 *     writing plaintext.
 *   • Update clears the verified state when account changes.
 */

const KEY_HEX = 'b'.repeat(64); // 32 bytes hex (distinct from seller test key)
const buildEnv = (key: string | undefined) => ({
  getString: (k: string, fallback?: string) => fallback ?? '',
  getOptional: (k: string) =>
    k === 'FRANCHISE_BANK_ENCRYPTION_KEY' ? key : undefined,
});

describe('FranchiseBankDetailsService', () => {
  it('encrypt/decrypt round-trip works', () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    const enc = (svc as any).encrypt('1234567890');
    const plain = svc.decrypt(enc);
    expect(plain).toBe('1234567890');
  });

  it('refuses operations when key is unset (BANK_DETAILS_UNAVAILABLE)', async () => {
    const env = buildEnv(undefined) as any;
    const prisma = {} as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        franchisePartnerId: 'f-1',
        accountHolderName: 'A B',
        accountNumber: '1234567890',
        ifscCode: 'HDFC0001234',
      }),
    ).rejects.toThrow(/Bank-details encryption is not configured/i);
  });

  it('rejects bad IFSC', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        franchisePartnerId: 'f-1',
        accountHolderName: 'A B',
        accountNumber: '1234567890',
        ifscCode: 'BADCODE',
      }),
    ).rejects.toThrow(/IFSC.+invalid/i);
  });

  it('rejects short account number', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        franchisePartnerId: 'f-1',
        accountHolderName: 'A B',
        accountNumber: '1234',
        ifscCode: 'HDFC0001234',
      }),
    ).rejects.toThrow(/Account number must be 9.18 digits/i);
  });

  it('rejects bad UPI VPA when provided', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        franchisePartnerId: 'f-1',
        accountHolderName: 'A B',
        accountNumber: '1234567890',
        ifscCode: 'HDFC0001234',
        upiVpa: 'not-a-vpa',
      }),
    ).rejects.toThrow(/UPI VPA is invalid/i);
  });

  it('rejects short account holder name', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        franchisePartnerId: 'f-1',
        accountHolderName: 'A',
        accountNumber: '1234567890',
        ifscCode: 'HDFC0001234',
      }),
    ).rejects.toThrow(/Account holder name must be at least 2 characters/i);
  });

  it('upsert clears verified state on update + writes last4', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const upsert = jest.fn().mockImplementation(async ({ create, update }) => {
      const data = update ?? create;
      return {
        franchisePartnerId: 'f-1',
        accountHolderName: data.accountHolderName,
        accountNumberLast4: data.accountNumberLast4,
        ifscCode: data.ifscCode,
        bankName: data.bankName ?? null,
        upiVpa: data.upiVpa ?? null,
        verifiedAt: data.verifiedAt ?? null,
        updatedAt: new Date(),
      };
    });
    const prisma = { franchiseBankDetails: { upsert } } as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    const out = await svc.upsert({
      franchisePartnerId: 'f-1',
      accountHolderName: 'A B',
      accountNumber: '1234567890',
      ifscCode: 'HDFC0001234',
    });
    expect(out.accountNumberLast4).toBe('7890');
    expect(out.ifscCode).toBe('HDFC0001234');
    const call = upsert.mock.calls[0][0];
    expect(call.update.verifiedAt).toBeNull();
    expect(call.update.verifiedBy).toBeNull();
    // accountNumberEnc must NOT be the plaintext.
    expect(call.create.accountNumberEnc).not.toBe('1234567890');
    expect(call.update.accountNumberEnc).not.toBe('1234567890');
  });

  it('getStatus returns hasBankDetails=false when no row', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {
      franchiseBankDetails: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new FranchiseBankDetailsService(env, prisma);
    const status = await svc.getStatus('f-1');
    expect(status.hasBankDetails).toBe(false);
  });
});
