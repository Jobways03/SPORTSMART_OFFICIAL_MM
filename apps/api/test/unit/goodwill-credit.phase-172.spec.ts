import 'reflect-metadata';
import { RefundInstructionService } from '../../src/modules/refund-instructions/application/services/refund-instruction.service';

// Phase 172 — GOODWILL_CREDIT Finance Approval remediation.
//   #1  goodwill ALWAYS queues for approval (unconditional, env can't bypass)
//   #2  isGoodwill + customerRemedy populated on the instruction
//   #5  amountInPaise accepted as bigint
//   #6/#8/#9  goodwill wallet credit: "goodwill" wording + creditType=GOODWILL + expiry

function build(opts: { envGoodwillFlag?: boolean } = {}) {
  let row: any = null;
  const wallet = {
    creditFromRefund: jest.fn(async () => ({ transaction: { id: 'wtx-1' } })),
  };
  // saga.run executes the single built step so we can assert the wallet call.
  const saga = {
    run: jest.fn(async (cfg: any) => {
      await cfg.steps[0].execute({
        instructionId: 'ri-1',
        customerId: cfg.customerId,
        amountInPaise: cfg.amountInPaise,
        refundMethod: 'WALLET',
        refundIdempotencyKey: cfg.idempotencyKey,
      });
      return { status: 'COMPLETED', finalContext: { walletTransactionId: 'wtx-1' } };
    }),
  };
  const prisma: any = {
    refundInstruction: {
      findUnique: jest.fn(async () => row),
      create: jest.fn(async ({ data }: any) => {
        row = { id: 'ri-1', ...data };
        return row;
      }),
      update: jest.fn(async ({ data }: any) => {
        row = { ...row, ...data };
        return row;
      }),
      count: jest.fn(async () => 0),
    },
  };
  const env: any = {
    getNumber: (k: string, d: number) =>
      k === 'GOODWILL_CREDIT_EXPIRY_DAYS' ? 180 : d,
    getBoolean: () => opts.envGoodwillFlag ?? true,
    getString: (_k: string, d: string) => d,
    getOptional: () => undefined,
  };
  const svc = new RefundInstructionService(
    prisma, env, wallet as any, saga as any, {} as any, { publish: jest.fn() } as any,
  );
  return { svc, prisma, wallet, saga, getRow: () => row };
}

describe('goodwill gate (#1) — unconditional queue', () => {
  it('queues a small goodwill credit even with the env auto-approve flag OFF', async () => {
    const { svc, getRow, saga } = build({ envGoodwillFlag: false });
    await svc.createForDispute({
      disputeId: 'd1', disputeNumber: 'DSP-1', customerId: 'c1', masterOrderId: 'mo1',
      amountInPaise: 100,
      customerRemedy: 'GOODWILL_CREDIT',
    });
    expect(getRow().status).toBe('PENDING_APPROVAL');
    expect(saga.run).not.toHaveBeenCalled();
  });
});

describe('createForDispute goodwill markers (#2/#5)', () => {
  it('sets isGoodwill + customerRemedy + customerVisibleMessage and accepts a bigint amount', async () => {
    const { svc, getRow } = build();
    await svc.createForDispute({
      disputeId: 'd2', disputeNumber: 'DSP-2', customerId: 'c1', masterOrderId: 'mo1',
      amountInPaise: 250000n,
      customerRemedy: 'GOODWILL_CREDIT',
      customerVisibleMessage: 'Sorry for the trouble',
    });
    expect(getRow().isGoodwill).toBe(true);
    expect(getRow().customerRemedy).toBe('GOODWILL_CREDIT');
    expect(getRow().customerVisibleMessage).toBe('Sorry for the trouble');
    expect(getRow().amountInPaise).toBe(250000n);
  });

  it('a non-goodwill refund has isGoodwill=false', async () => {
    const { svc, getRow } = build();
    await svc.createForDispute({
      disputeId: 'd3', disputeNumber: 'DSP-3', customerId: 'c1', masterOrderId: 'mo1',
      amountInPaise: 5000, customerRemedy: 'FULL_REFUND',
    });
    expect(getRow().isGoodwill).toBe(false);
  });
});

describe('goodwill wallet credit step (#6/#8/#9)', () => {
  // walletCreditStep is the saga step that actually moves money. Drive it
  // directly — goodwill ALWAYS queues (so it never auto-runs the saga inline),
  // and the full approveByFinance machinery (CAS updateMany + status history)
  // is out of scope for this unit. This tests exactly the wording + creditType
  // + expiry selection that #6/#8/#9 introduced.
  const ctx = {
    instructionId: 'ri-1',
    customerId: 'c1',
    amountInPaise: 75000,
    refundMethod: 'WALLET',
    refundIdempotencyKey: 'k1',
  };

  it('goodwill → goodwill wording + creditType=GOODWILL + an expiry date', async () => {
    const { svc, wallet } = build();
    const step = (svc as any).walletCreditStep({
      sourceType: 'DISPUTE',
      label: 'DSP-4',
      isGoodwill: true,
    });
    await step.execute(ctx);
    expect(wallet.creditFromRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        creditType: 'GOODWILL',
        expiresAt: expect.any(Date),
        description: expect.stringMatching(/goodwill credit/i),
      }),
    );
  });

  it('goodwill with a finance customer-visible message uses that exact message', async () => {
    const { svc, wallet } = build();
    const step = (svc as any).walletCreditStep({
      sourceType: 'DISPUTE',
      label: 'DSP-4',
      isGoodwill: true,
      customerVisibleMessage: 'Apologies — here is ₹750 of store credit',
    });
    await step.execute(ctx);
    expect(wallet.creditFromRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        creditType: 'GOODWILL',
        description: 'Apologies — here is ₹750 of store credit',
      }),
    );
  });

  it('genuine refund → REFUND_ORIGINAL + no expiry + refund wording', async () => {
    const { svc, wallet } = build();
    const step = (svc as any).walletCreditStep({
      sourceType: 'DISPUTE',
      label: 'DSP-5',
      isGoodwill: false,
    });
    await step.execute(ctx);
    expect(wallet.creditFromRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        creditType: 'REFUND_ORIGINAL',
        expiresAt: undefined,
        description: expect.stringMatching(/refunded to wallet/i),
      }),
    );
  });
});
