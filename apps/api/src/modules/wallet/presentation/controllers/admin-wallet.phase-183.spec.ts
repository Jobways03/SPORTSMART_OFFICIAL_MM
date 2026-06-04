import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UnauthorizedException } from '@nestjs/common';
import { AdminWalletController } from './admin-wallet.controller';
import { AdminCreditDto, AdminDebitDto } from '../dtos/wallet.dtos';
import { WalletService } from '../../application/services/wallet.service';

// Phase 183 — Wallet Credit/Debit (admin manual adjustment) audit remediation.

describe('#1/#6/#11 AdminCreditDto / AdminDebitDto validation', () => {
  const valid = { amountInPaise: 5000, reason: 'Comp for SR-2026-0123 SLA miss', description: 'Goodwill credit' };

  it('accepts a well-formed credit', async () => {
    expect(await validate(plainToInstance(AdminCreditDto, valid))).toHaveLength(0);
  });
  it('rejects a missing/empty reason (#2)', async () => {
    expect((await validate(plainToInstance(AdminCreditDto, { ...valid, reason: '' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AdminCreditDto, { amountInPaise: 5000, description: 'x' }))).length).toBeGreaterThan(0);
  });
  it('rejects an amount over the ₹5L cap (#6)', async () => {
    const errs = await validate(plainToInstance(AdminCreditDto, { ...valid, amountInPaise: 50_000_001 }));
    expect(errs.some((e) => e.property === 'amountInPaise')).toBe(true);
  });
  it('rejects a non-positive / non-integer amount', async () => {
    expect((await validate(plainToInstance(AdminCreditDto, { ...valid, amountInPaise: 0 }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AdminCreditDto, { ...valid, amountInPaise: 1.5 }))).length).toBeGreaterThan(0);
  });
  it('rejects XSS-prone description/reason (#11)', async () => {
    expect((await validate(plainToInstance(AdminCreditDto, { ...valid, description: '<script>alert(1)</script>' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(AdminCreditDto, { ...valid, reason: '<img src=x onerror=alert(1)>' }))).length).toBeGreaterThan(0);
  });
  it('rejects a malformed referenceNumber (#3)', async () => {
    expect((await validate(plainToInstance(AdminCreditDto, { ...valid, referenceNumber: 'has spaces!' }))).length).toBeGreaterThan(0);
    expect(await validate(plainToInstance(AdminCreditDto, { ...valid, referenceNumber: 'SR-2026-0123' }))).toHaveLength(0);
  });
  it('omitting internalNotes is valid (was a latent @IsOptional bug)', async () => {
    expect(await validate(plainToInstance(AdminDebitDto, valid))).toHaveLength(0);
  });
});

describe('#3/#4/#5 controller credit/debit', () => {
  function makeCtrl() {
    const wallet: any = { credit: jest.fn().mockResolvedValue({ wallet: { balanceInPaise: 5000 }, transaction: { id: 't1' } }), debit: jest.fn().mockResolvedValue({ wallet: { balanceInPaise: 0 }, transaction: { id: 't2' } }) };
    return { ctrl: new AdminWalletController(wallet as WalletService, {} as any), wallet };
  }

  it('#4 — uses req.adminId as the actor, NOT req.userId', async () => {
    const { ctrl, wallet } = makeCtrl();
    await ctrl.creditWallet({ adminId: 'admin-9', userId: 'cust-evil' }, 'u1', { amountInPaise: 5000, reason: 'r', description: 'd' } as any);
    const arg = wallet.credit.mock.calls[0][0];
    expect(arg.createdByAdminId).toBe('admin-9');
    expect(arg.type).toBe('MANUAL_CREDIT'); // #5
    expect(arg.reason).toBe('r'); // #2
    expect(arg.referenceType).toBe('MANUAL_ADJUSTMENT'); // #3
    expect(arg.referenceId).toBeTruthy();
  });

  it('#4 — throws (does NOT fall back to req.userId) when no admin id present', async () => {
    const { ctrl } = makeCtrl();
    await expect(ctrl.creditWallet({ userId: 'cust-1' }, 'u1', { amountInPaise: 5000, reason: 'r', description: 'd' } as any)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('#3 — a supplied referenceNumber becomes the idempotency referenceId', async () => {
    const { ctrl, wallet } = makeCtrl();
    await ctrl.debitWallet({ adminId: 'admin-9' }, 'u1', { amountInPaise: 5000, reason: 'r', description: 'd', referenceNumber: 'TKT-42' } as any);
    expect(wallet.debit.mock.calls[0][0].referenceId).toBe('TKT-42');
    expect(wallet.debit.mock.calls[0][0].type).toBe('MANUAL_DEBIT'); // #5
  });
});

describe('#3/#16 service debit idempotency + failure event', () => {
  const wallet: any = { id: 'w1', userId: 'u1', balanceInPaise: 100000, version: 0, isBlocked: false };
  function build(repoOverrides: any) {
    const repo: any = {
      findByUserId: jest.fn().mockResolvedValue(wallet),
      getOrCreate: jest.fn().mockResolvedValue(wallet),
      findTransactionByReference: jest.fn().mockResolvedValue(null),
      applyMutation: jest.fn().mockResolvedValue({ wallet, transaction: { id: 'd1' } }),
      ...repoOverrides,
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const svc = new WalletService(repo, {} as any, eventBus, { writeAuditLog: jest.fn() } as any, {} as any);
    return { svc, repo, eventBus };
  }

  it('#3 — a referenced debit returns the existing row (no second mutation)', async () => {
    const { svc, repo } = build({ findTransactionByReference: jest.fn().mockResolvedValue({ id: 'existing-d' }) });
    const r = await svc.debit({ userId: 'u1', amountInPaise: 5000, description: 'd', type: 'MANUAL_DEBIT', referenceType: 'MANUAL_ADJUSTMENT', referenceId: 'TKT-42' });
    expect(r.transaction.id).toBe('existing-d');
    expect(repo.applyMutation).not.toHaveBeenCalled();
  });

  it('#16 — a failed debit emits wallet.debit.failed and rethrows', async () => {
    const low = { ...wallet, balanceInPaise: 100 }; // insufficient
    const { svc, eventBus } = build({ findByUserId: jest.fn().mockResolvedValue(low), getOrCreate: jest.fn().mockResolvedValue(low) });
    await expect(svc.debit({ userId: 'u1', amountInPaise: 5000, description: 'd' })).rejects.toBeTruthy();
    expect(eventBus.publish).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'wallet.debit.failed' }));
  });
});
