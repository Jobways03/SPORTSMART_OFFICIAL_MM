import 'reflect-metadata';
import { EInvoiceRetryCron } from '../../src/modules/tax/application/jobs/einvoice-retry.cron';
import { EInvoiceDisabledError } from '../../src/modules/tax/application/services/einvoice.service';
import { EINVOICE_EVENTS } from '../../src/modules/tax/domain/einvoice-events';

// Phase 160 — e-invoice retry cron hardening: kill-switch skip (#2),
// inter-call rate pacing (#11), tax-mode escalation (#12), and the
// retry-exhausted domain event (#17).

function build(opts: {
  enabled?: boolean;
  candidates?: { id: string; documentNumber: string }[];
  exhausted?: { id: string; documentNumber: string; einvoiceFailureReason: string | null }[];
  interCallMs?: number;
} = {}) {
  const candidates = opts.candidates ?? [];
  const exhausted = opts.exhausted ?? [];
  const taxDocument = {
    findMany: jest
      .fn()
      // 1st call = candidate scan; 2nd call = exhausted scan.
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce(exhausted),
  };
  const adminTask = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  };
  const prisma = { taxDocument, adminTask } as any;
  const env: any = {
    getBoolean: (_k: string, fb: boolean) => fb,
    getNumber: (k: string, fb: number) =>
      k === 'TAX_EINVOICE_RETRY_INTER_CALL_MS' ? (opts.interCallMs ?? 0) : fb,
  };
  const leader = { run: jest.fn() } as any;
  const instr = { wrap: jest.fn() } as any;
  const einvoice = {
    isEnabled: jest.fn().mockResolvedValue(opts.enabled ?? true),
    generateForDocument: jest.fn().mockResolvedValue({}),
  } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const taxMode = { report: jest.fn().mockResolvedValue(null) } as any;
  const cron = new EInvoiceRetryCron(prisma, env, leader, instr, einvoice, eventBus, taxMode);
  (cron as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { cron, einvoice, eventBus, taxMode, adminTask };
}

describe('EInvoiceRetryCron.runOnce', () => {
  it('skips the whole sweep when e-invoicing is disabled (#2)', async () => {
    const { cron, einvoice } = build({
      enabled: false,
      candidates: [{ id: 'd1', documentNumber: 'N1' }],
    });
    const counts = await cron.runOnce();
    expect(counts.scanned).toBe(0);
    expect(einvoice.generateForDocument).not.toHaveBeenCalled();
  });

  it('generates each candidate when enabled', async () => {
    const { cron, einvoice } = build({
      enabled: true,
      candidates: [
        { id: 'd1', documentNumber: 'N1' },
        { id: 'd2', documentNumber: 'N2' },
      ],
      interCallMs: 0,
    });
    const counts = await cron.runOnce();
    expect(counts.scanned).toBe(2);
    expect(counts.generated).toBe(2);
    expect(einvoice.generateForDocument).toHaveBeenCalledTimes(2);
  });

  it('stops the sweep if disabled mid-run (EInvoiceDisabledError)', async () => {
    const { cron, einvoice } = build({
      enabled: true,
      candidates: [
        { id: 'd1', documentNumber: 'N1' },
        { id: 'd2', documentNumber: 'N2' },
      ],
      interCallMs: 0,
    });
    einvoice.generateForDocument
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new EInvoiceDisabledError('d2'));
    const counts = await cron.runOnce();
    expect(counts.generated).toBe(1); // d1 only; broke on d2
  });

  it('on cap-exhaustion: opens AdminTask + emits RETRY_EXHAUSTED + reports to tax-mode (#12/#17)', async () => {
    const { cron, eventBus, taxMode, adminTask } = build({
      enabled: true,
      candidates: [],
      exhausted: [{ id: 'dx', documentNumber: 'NX', einvoiceFailureReason: 'NIC 2253' }],
    });
    const counts = await cron.runOnce();
    expect(counts.escalated).toBe(1);
    expect(adminTask.create).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: EINVOICE_EVENTS.RETRY_EXHAUSTED }),
    );
    expect(taxMode.report).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'einvoice.generation_failed' }),
    );
  });

  it('survives a STRICT-mode tax report throw during escalation', async () => {
    const { cron, taxMode, adminTask } = build({
      enabled: true,
      candidates: [],
      exhausted: [{ id: 'dx', documentNumber: 'NX', einvoiceFailureReason: null }],
    });
    taxMode.report.mockRejectedValue(new Error('STRICT violation'));
    const counts = await cron.runOnce();
    // The AdminTask still opened; the throw was caught.
    expect(counts.escalated).toBe(1);
    expect(adminTask.create).toHaveBeenCalled();
  });
});
