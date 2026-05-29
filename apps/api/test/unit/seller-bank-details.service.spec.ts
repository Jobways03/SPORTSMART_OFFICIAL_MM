import 'reflect-metadata';
import { SellerBankDetailsService } from '../../src/modules/seller/application/services/seller-bank-details.service';

/**
 * Phase 19 (2026-05-20) — SellerBankDetailsService unit tests.
 *
 * Verifies:
 *   • Encryption round-trip (encrypt → decrypt yields original).
 *   • Validation rejects bad IFSC / account number / UPI VPA.
 *   • Missing key surfaces BANK_DETAILS_UNAVAILABLE rather than
 *     silently writing plaintext.
 *   • Update clears the verified state when account changes.
 */

const KEY_HEX = 'a'.repeat(64); // 32 bytes hex
const buildEnv = (key: string | undefined) => ({
  getString: (k: string, fallback?: string) => fallback ?? '',
  getOptional: (k: string) =>
    k === 'SELLER_BANK_ENCRYPTION_KEY' ? key : undefined,
});

describe('SellerBankDetailsService', () => {
  it('encrypt/decrypt round-trip works', () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new SellerBankDetailsService(env, prisma);
    const enc = (svc as any).encrypt('1234567890');
    const plain = svc.decrypt(enc);
    expect(plain).toBe('1234567890');
  });

  it('refuses operations when key is unset', async () => {
    const env = buildEnv(undefined) as any;
    const prisma = {} as any;
    const svc = new SellerBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        sellerId: 's-1',
        accountHolderName: 'A B',
        accountNumber: '1234567890',
        ifscCode: 'HDFC0001234',
      }),
    ).rejects.toThrow(/Bank-details encryption is not configured/i);
  });

  it('rejects bad IFSC', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new SellerBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        sellerId: 's-1',
        accountHolderName: 'A B',
        accountNumber: '1234567890',
        ifscCode: 'BADCODE',
      }),
    ).rejects.toThrow(/IFSC.+invalid/i);
  });

  it('rejects short account number', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new SellerBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        sellerId: 's-1',
        accountHolderName: 'A B',
        accountNumber: '1234',
        ifscCode: 'HDFC0001234',
      }),
    ).rejects.toThrow(/Account number must be 9.18 digits/i);
  });

  it('rejects bad UPI VPA when provided', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const prisma = {} as any;
    const svc = new SellerBankDetailsService(env, prisma);
    await expect(
      svc.upsert({
        sellerId: 's-1',
        accountHolderName: 'A B',
        accountNumber: '1234567890',
        ifscCode: 'HDFC0001234',
        upiVpa: 'not-an-upi',
      }),
    ).rejects.toThrow(/UPI VPA is invalid/i);
  });

  it('upsert: encrypts account number, stores last4, clears verifiedAt on update', async () => {
    const env = buildEnv(KEY_HEX) as any;
    const upsertMock = jest.fn().mockResolvedValue({
      sellerId: 's-1',
      accountHolderName: 'A B',
      accountNumberLast4: '7890',
      ifscCode: 'HDFC0001234',
      bankName: null,
      upiVpa: null,
      verifiedAt: null,
      updatedAt: new Date(),
    });
    const prisma = {
      sellerBankDetails: { upsert: upsertMock },
    } as any;
    const svc = new SellerBankDetailsService(env, prisma);

    await svc.upsert({
      sellerId: 's-1',
      accountHolderName: 'A B',
      accountNumber: '1234567890',
      ifscCode: 'HDFC0001234',
    });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const args = upsertMock.mock.calls[0][0];
    // last4 stored as readable string
    expect(args.create.accountNumberLast4).toBe('7890');
    // ciphertext written, not plaintext
    expect(args.create.accountNumberEnc).not.toContain('1234567890');
    // update clears verifiedAt
    expect(args.update.verifiedAt).toBeNull();
    expect(args.update.verifiedBy).toBeNull();
  });
});
