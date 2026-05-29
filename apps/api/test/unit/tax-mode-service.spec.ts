import 'reflect-metadata';
import {
  TaxModeService,
  TaxStrictModeViolationError,
  TAX_MODE_AUDIT_ACTION,
  TAX_MODE_AUDIT_MODULE,
} from '../../src/modules/tax/application/services/tax-mode.service';

// Phase 23 GST — TaxModeService tests. Updated Phase 159w (GST Mode Toggle
// audit): authoritative single `tax_mode` key (#7), history (B3), event (#8),
// audit log (B3/#16), getModeInfo source (#14).

function makeService(
  opts: {
    taxConfig?: Partial<Record<'tax_strict_mode' | 'tax_audit_mode', boolean>> & {
      tax_mode?: string;
    };
    env?: Partial<Record<'TAX_STRICT_MODE' | 'TAX_AUDIT_MODE', boolean>>;
    rowCount?: number;
  } = {},
) {
  const taxConfig: any = {
    getBoolean: jest.fn(async (key: string, fb: boolean) => {
      const cfg = opts.taxConfig ?? {};
      if (key === 'tax_strict_mode' && cfg.tax_strict_mode !== undefined) return cfg.tax_strict_mode;
      if (key === 'tax_audit_mode' && cfg.tax_audit_mode !== undefined) return cfg.tax_audit_mode;
      return fb;
    }),
    getString: jest.fn(async (key: string, fb: string) => {
      const cfg = opts.taxConfig ?? {};
      if (key === 'tax_mode' && cfg.tax_mode !== undefined) return cfg.tax_mode;
      return fb;
    }),
    invalidate: jest.fn(),
  };
  const env: any = {
    getBoolean: jest.fn((key: string, fb: boolean) => {
      const e = opts.env ?? {};
      if (key === 'TAX_STRICT_MODE' && e.TAX_STRICT_MODE !== undefined) return e.TAX_STRICT_MODE;
      if (key === 'TAX_AUDIT_MODE' && e.TAX_AUDIT_MODE !== undefined) return e.TAX_AUDIT_MODE;
      return fb;
    }),
  };
  const prisma: any = {
    taxConfig: {
      count: jest.fn(async () => opts.rowCount ?? 1),
      upsert: jest.fn(async (a: any) => a),
    },
    gstModeHistory: { create: jest.fn(async (a: any) => ({ id: 'h1', ...a.data })) },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const service = new TaxModeService(env, taxConfig, prisma, eventBus, audit);
  return { service, taxConfig, prisma, eventBus, audit };
}

describe('TaxModeService.getMode', () => {
  it('returns OFF when both flags off (default)', async () => {
    expect(await makeService().service.getMode()).toBe('OFF');
  });
  it('returns AUDIT when only tax_audit_mode is true', async () => {
    expect(await makeService({ taxConfig: { tax_audit_mode: true } }).service.getMode()).toBe('AUDIT');
  });
  it('returns STRICT when tax_strict_mode is true (audit implied)', async () => {
    expect(await makeService({ taxConfig: { tax_strict_mode: true } }).service.getMode()).toBe('STRICT');
  });
  it('honours env fallback when tax_config row is missing', async () => {
    expect(await makeService({ env: { TAX_AUDIT_MODE: true } }).service.getMode()).toBe('AUDIT');
  });
  it('tax_config takes precedence over env', async () => {
    const { service } = makeService({
      taxConfig: { tax_strict_mode: false },
      env: { TAX_STRICT_MODE: true },
    });
    expect(await service.getMode()).toBe('OFF');
  });

  // Phase 159w (#7) — the authoritative single key wins over the flags.
  it('honours the authoritative tax_mode key over the legacy flags', async () => {
    const { service } = makeService({
      taxConfig: { tax_mode: 'STRICT', tax_strict_mode: false, tax_audit_mode: false },
    });
    expect(await service.getMode()).toBe('STRICT');
  });
});

describe('TaxModeService.getModeInfo (#14)', () => {
  it('reports source=db when a tax_config row exists', async () => {
    const info = await makeService({ rowCount: 2 }).service.getModeInfo();
    expect(info.source).toBe('db');
  });
  it('reports source=env when no tax_config rows exist', async () => {
    const info = await makeService({ rowCount: 0, env: { TAX_STRICT_MODE: true } }).service.getModeInfo();
    expect(info).toEqual({ mode: 'STRICT', source: 'env' });
  });
});

describe('TaxModeService.setMode (#3/#7/#8/B3)', () => {
  it('writes the authoritative key + both flags + a history row in one tx', async () => {
    const { service, prisma } = makeService();
    const res = await service.setMode('STRICT', 'admin-1', { reason: 'go live' });

    expect(res).toEqual({ from: 'OFF', to: 'STRICT' });
    const upsertKeys = prisma.taxConfig.upsert.mock.calls.map((c: any[]) => c[0].where.key);
    expect(upsertKeys).toEqual(expect.arrayContaining(['tax_mode', 'tax_audit_mode', 'tax_strict_mode']));
    // authoritative key carries the literal mode
    const modeCall = prisma.taxConfig.upsert.mock.calls.find((c: any[]) => c[0].where.key === 'tax_mode');
    expect(modeCall[0].create.value).toBe('STRICT');
    expect(prisma.gstModeHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fromMode: 'OFF', toMode: 'STRICT', actorId: 'admin-1' }) }),
    );
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('publishes tax.mode.changed and writes a TAX_MODE_CHANGED audit row', async () => {
    const { service, eventBus, audit } = makeService();
    await service.setMode('AUDIT', 'admin-1');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'tax.mode.changed', payload: expect.objectContaining({ to: 'AUDIT' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: TAX_MODE_AUDIT_ACTION,
        module: TAX_MODE_AUDIT_MODULE,
        oldValue: { mode: 'OFF' },
        newValue: { mode: 'AUDIT' },
      }),
    );
  });

  it('records a forced override (with blocker count) on the history row', async () => {
    const { service, prisma } = makeService();
    await service.setMode('STRICT', 'admin-1', { forced: true, blockerCount: 7 });
    expect(prisma.gstModeHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ forced: true, blockerCount: 7 }) }),
    );
  });

  it('defaults a null actor to "system" in the audit row', async () => {
    const { service, audit } = makeService();
    await service.setMode('OFF', null);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'system' }));
  });
});

describe('TaxModeService.report', () => {
  const violation = { code: 'product.missing_hsn', message: 'Product missing HSN', context: { productId: 'p-1' } };

  it('OFF — returns null silently', async () => {
    expect(await makeService().service.report(violation)).toBeNull();
  });
  it('AUDIT — returns the violation (logged, not thrown)', async () => {
    const { service } = makeService({ taxConfig: { tax_audit_mode: true } });
    expect(await service.report(violation)).toEqual(violation);
  });
  it('STRICT — throws TaxStrictModeViolationError preserving the payload', async () => {
    const { service } = makeService({ taxConfig: { tax_strict_mode: true } });
    await expect(service.report(violation)).rejects.toThrow(TaxStrictModeViolationError);
  });
});

describe('TaxModeService.shouldShowDraftBanner', () => {
  it('OFF / AUDIT keep banner on; STRICT suppresses', () => {
    expect(TaxModeService.shouldShowDraftBanner('OFF')).toBe(true);
    expect(TaxModeService.shouldShowDraftBanner('AUDIT')).toBe(true);
    expect(TaxModeService.shouldShowDraftBanner('STRICT')).toBe(false);
  });
});
