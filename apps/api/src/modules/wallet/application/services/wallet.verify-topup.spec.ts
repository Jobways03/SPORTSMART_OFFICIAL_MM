import * as crypto from 'crypto';
import { WalletService } from './wallet.service';
import { WalletRepository } from '../../domain/repositories/wallet.repository.interface';

/**
 * Phase 0 (PR 0.2) — wallet top-up amount-check.
 *
 * The HMAC signature proves Razorpay emitted the (order_id, payment_id)
 * pair. It does NOT prove the captured amount equals the pending row's
 * amount. Without this guard, a malicious / accidental client could
 * submit a low-value payment id and have the full pending top-up amount
 * credited. These tests pin down the rejection contract end-to-end.
 */

const KEY_SECRET = 'rzp_test_secret_min32chars_phase0_topup';
const userId = 'cust-99';
const walletTransactionId = 'wtx-pending-1';
const razorpayOrderId = 'order_test_topup1';
const razorpayPaymentId = 'pay_test_topup1';

function sign(orderId: string, paymentId: string, key = KEY_SECRET) {
  return crypto
    .createHmac('sha256', key)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

function makePendingTx(overrides: Partial<{ amountInPaise: number; referenceId: string; userId: string; type: string }> = {}) {
  return {
    id: walletTransactionId,
    userId,
    type: 'TOPUP',
    amountInPaise: 1_000_000,                  // ₹10,000
    referenceType: 'razorpay_order',
    referenceId: razorpayOrderId,
    ...overrides,
  } as any;
}

function buildService(opts: {
  pendingTx?: ReturnType<typeof makePendingTx>;
  rawPayment?: any;
  rawPaymentThrows?: Error;
  applyMutationMock?: jest.Mock;
}) {
  const findTransactionById = jest.fn().mockResolvedValue(opts.pendingTx ?? makePendingTx());
  const completePending = jest.fn();
  const repo: WalletRepository = {
    findByUserId: jest.fn(),
    getOrCreate: jest.fn().mockResolvedValue({ id: 'w-99', balanceInPaise: 0, version: 0 }),
    listTransactions: jest.fn(),
    findTransactionByReference: jest.fn(),
    findTransactionById,
    applyMutation: opts.applyMutationMock ?? jest.fn(),
    completePending,
    insertPending: jest.fn(),
    blockWallet: jest.fn(),
    unblockWallet: jest.fn(),
  } as unknown as WalletRepository;

  const razorpay = {
    getRawPayment: jest.fn().mockImplementation(async () => {
      if (opts.rawPaymentThrows) throw opts.rawPaymentThrows;
      return opts.rawPayment ?? {
        id: razorpayPaymentId,
        amount: 1_000_000,
        currency: 'INR',
        status: 'captured',
        order_id: razorpayOrderId,
        method: 'upi',
        captured: true,
      };
    }),
  } as any;

  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const paymentOps = {
    flagMismatch: jest.fn().mockResolvedValue(undefined),
    recordAttempt: jest.fn().mockResolvedValue(undefined),
  } as any;

  const service = new WalletService(repo, razorpay, eventBus, audit, paymentOps);
  return { service, repo, razorpay, paymentOps, completePending, findTransactionById };
}

describe('WalletService.verifyTopup — Phase 0 amount-check', () => {
  const previousKey = process.env.RAZORPAY_KEY_SECRET;
  beforeAll(() => {
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });
  afterAll(() => {
    if (previousKey === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = previousKey;
  });

  it('credits the wallet on a fully-matching gateway snapshot', async () => {
    const { service, razorpay, paymentOps, completePending } = buildService({});
    completePending.mockResolvedValue({
      wallet: { id: 'w-99', balanceInPaise: 1_000_000, version: 1 },
      transaction: { id: walletTransactionId },
    });

    const result = await service.verifyTopup({
      userId,
      walletTransactionId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
    });

    expect(razorpay.getRawPayment).toHaveBeenCalledWith(razorpayPaymentId);
    expect(completePending).toHaveBeenCalledTimes(1);
    expect(paymentOps.flagMismatch).not.toHaveBeenCalled();
    expect(result.wallet.balanceInPaise).toBe(1_000_000);
  });

  // ── Headline silent-loss case ──────────────────────────────────────

  it('REJECTS when gateway amount is less than the pending top-up amount (the ₹1-for-₹10k attack)', async () => {
    const { service, paymentOps, completePending } = buildService({
      rawPayment: {
        id: razorpayPaymentId,
        amount: 100,                            // 1 paise — way under the expected 1_000_000
        currency: 'INR',
        status: 'captured',
        order_id: razorpayOrderId,
        method: 'upi',
        captured: true,
      },
    });

    await expect(
      service.verifyTopup({
        userId,
        walletTransactionId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_AMOUNT_MISMATCH' });

    // Wallet MUST NOT be credited
    expect(completePending).not.toHaveBeenCalled();
    // PaymentMismatchAlert MUST be recorded so finance ops see it
    expect(paymentOps.flagMismatch).toHaveBeenCalledTimes(1);
    expect(paymentOps.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'AMOUNT_MISMATCH',
        providerPaymentId: razorpayPaymentId,
        // Phase 143 — production now emits the gateway amount as a BigInt paise
        // value (ADR-007 migration); the guard itself is unchanged (it still
        // rejects the ₹1-for-₹10k attack — this assertion proves it fires).
        expectedInPaise: 1_000_000,
        actualInPaise: BigInt(100),
        severity: 95,
      }),
    );
  });

  it('rejects an over-payment', async () => {
    const { service, paymentOps, completePending } = buildService({
      rawPayment: {
        id: razorpayPaymentId,
        amount: 1_000_001,
        currency: 'INR',
        status: 'captured',
        order_id: razorpayOrderId,
        method: 'upi',
        captured: true,
      },
    });

    await expect(
      service.verifyTopup({
        userId,
        walletTransactionId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_AMOUNT_MISMATCH' });

    expect(completePending).not.toHaveBeenCalled();
  });

  it('rejects an authorized-but-not-captured payment', async () => {
    const { service, completePending } = buildService({
      rawPayment: {
        id: razorpayPaymentId,
        amount: 1_000_000,
        currency: 'INR',
        status: 'authorized',
        order_id: razorpayOrderId,
        method: 'upi',
        captured: false,
      },
    });

    await expect(
      service.verifyTopup({
        userId,
        walletTransactionId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_PAYMENT_NOT_CAPTURED' });

    expect(completePending).not.toHaveBeenCalled();
  });

  it('rejects when the gateway order_id differs from the pending row razorpayOrderId', async () => {
    const { service, paymentOps, completePending } = buildService({
      rawPayment: {
        id: razorpayPaymentId,
        amount: 1_000_000,
        currency: 'INR',
        status: 'captured',
        order_id: 'order_other_user',           // a different razorpay order
        method: 'upi',
        captured: true,
      },
    });

    await expect(
      service.verifyTopup({
        userId,
        walletTransactionId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_ORDER_ID_MISMATCH' });

    expect(completePending).not.toHaveBeenCalled();
    expect(paymentOps.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SIGNATURE_INVALID' }),
    );
  });

  // ── Pre-existing checks still pass (no regression) ─────────────────

  it('still rejects an invalid HMAC signature BEFORE calling the gateway', async () => {
    const { service, razorpay } = buildService({});

    await expect(
      service.verifyTopup({
        userId,
        walletTransactionId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: 'wrong-signature-here',
      }),
    ).rejects.toThrow(/signature verification failed/);

    // We MUST NOT spend a Razorpay API call on bad-signature traffic
    expect(razorpay.getRawPayment).not.toHaveBeenCalled();
  });

  it('still rejects when referenceId on the pending row does not match the supplied razorpayOrderId', async () => {
    const { service, razorpay } = buildService({
      pendingTx: makePendingTx({ referenceId: 'order_completely_different' }),
    });

    await expect(
      service.verifyTopup({
        userId,
        walletTransactionId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
      }),
    ).rejects.toThrow(/does not match the Razorpay order/);

    expect(razorpay.getRawPayment).not.toHaveBeenCalled();
  });

  // ── Gateway HTTP failure handling ─────────────────────────────────

  it('returns a retryable error when the gateway is unreachable', async () => {
    const { service, completePending } = buildService({
      rawPaymentThrows: new Error('ECONNRESET'),
    });

    await expect(
      service.verifyTopup({
        userId,
        walletTransactionId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
      }),
    ).rejects.toThrow(/could not confirm with gateway/);

    expect(completePending).not.toHaveBeenCalled();
  });
});
