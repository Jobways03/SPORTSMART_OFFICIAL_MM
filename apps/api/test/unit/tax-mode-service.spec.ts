import 'reflect-metadata';
import {
  TaxModeService,
  TaxStrictModeViolationError,
} from '../../src/modules/tax/application/services/tax-mode.service';

// Phase 23 GST — TaxModeService tests.
//
// Verifies the three-mode resolution (OFF / AUDIT / STRICT), source-of-
// truth precedence (tax_config over env), and `report()` outcomes per
// mode (silent / log / throw).

function makeService(opts: {
  taxConfig?: Partial<Record<'tax_strict_mode' | 'tax_audit_mode', boolean>>;
  env?: Partial<Record<'TAX_STRICT_MODE' | 'TAX_AUDIT_MODE', boolean>>;
} = {}): { service: TaxModeService } {
  const taxConfig: any = {
    getBoolean: jest.fn(async (key: string, fb: boolean) => {
      const cfg = opts.taxConfig ?? {};
      if (key === 'tax_strict_mode' && cfg.tax_strict_mode !== undefined) {
        return cfg.tax_strict_mode;
      }
      if (key === 'tax_audit_mode' && cfg.tax_audit_mode !== undefined) {
        return cfg.tax_audit_mode;
      }
      return fb;
    }),
  };
  const env: any = {
    getBoolean: jest.fn((key: string, fb: boolean) => {
      const e = opts.env ?? {};
      if (key === 'TAX_STRICT_MODE' && e.TAX_STRICT_MODE !== undefined) {
        return e.TAX_STRICT_MODE;
      }
      if (key === 'TAX_AUDIT_MODE' && e.TAX_AUDIT_MODE !== undefined) {
        return e.TAX_AUDIT_MODE;
      }
      return fb;
    }),
  };
  return { service: new TaxModeService(env, taxConfig) };
}

describe('TaxModeService.getMode', () => {
  it('returns OFF when both flags off (default)', async () => {
    const { service } = makeService();
    expect(await service.getMode()).toBe('OFF');
  });

  it('returns AUDIT when only tax_audit_mode is true', async () => {
    const { service } = makeService({ taxConfig: { tax_audit_mode: true } });
    expect(await service.getMode()).toBe('AUDIT');
  });

  it('returns STRICT when tax_strict_mode is true (audit implied)', async () => {
    const { service } = makeService({
      taxConfig: { tax_strict_mode: true },
    });
    expect(await service.getMode()).toBe('STRICT');
  });

  it('returns STRICT when both flags are true (strict wins)', async () => {
    const { service } = makeService({
      taxConfig: { tax_strict_mode: true, tax_audit_mode: true },
    });
    expect(await service.getMode()).toBe('STRICT');
  });

  it('honours env fallback when tax_config row is missing', async () => {
    const { service } = makeService({ env: { TAX_AUDIT_MODE: true } });
    expect(await service.getMode()).toBe('AUDIT');
  });

  it('tax_config takes precedence over env', async () => {
    const { service } = makeService({
      taxConfig: { tax_strict_mode: false },
      env: { TAX_STRICT_MODE: true },
    });
    expect(await service.getMode()).toBe('OFF');
  });
});

describe('TaxModeService.isStrict / isAuditOrStrict', () => {
  it('isStrict is true only in STRICT mode', async () => {
    const off = makeService();
    const audit = makeService({ taxConfig: { tax_audit_mode: true } });
    const strict = makeService({ taxConfig: { tax_strict_mode: true } });
    expect(await off.service.isStrict()).toBe(false);
    expect(await audit.service.isStrict()).toBe(false);
    expect(await strict.service.isStrict()).toBe(true);
  });

  it('isAuditOrStrict is true in AUDIT or STRICT', async () => {
    const off = makeService();
    const audit = makeService({ taxConfig: { tax_audit_mode: true } });
    const strict = makeService({ taxConfig: { tax_strict_mode: true } });
    expect(await off.service.isAuditOrStrict()).toBe(false);
    expect(await audit.service.isAuditOrStrict()).toBe(true);
    expect(await strict.service.isAuditOrStrict()).toBe(true);
  });
});

describe('TaxModeService.report', () => {
  const violation = {
    code: 'product.missing_hsn',
    message: 'Product missing HSN',
    context: { productId: 'p-1' },
  };

  it('OFF — returns null silently', async () => {
    const { service } = makeService();
    expect(await service.report(violation)).toBeNull();
  });

  it('AUDIT — returns the violation (logged, not thrown)', async () => {
    const { service } = makeService({
      taxConfig: { tax_audit_mode: true },
    });
    const r = await service.report(violation);
    expect(r).toEqual(violation);
  });

  it('STRICT — throws TaxStrictModeViolationError', async () => {
    const { service } = makeService({
      taxConfig: { tax_strict_mode: true },
    });
    await expect(service.report(violation)).rejects.toThrow(
      TaxStrictModeViolationError,
    );
  });

  it('STRICT — thrown error preserves the violation payload', async () => {
    const { service } = makeService({
      taxConfig: { tax_strict_mode: true },
    });
    try {
      await service.report(violation);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(TaxStrictModeViolationError);
      expect((err as TaxStrictModeViolationError).violation).toEqual(violation);
    }
  });
});

describe('TaxModeService.shouldShowDraftBanner', () => {
  it('OFF / AUDIT keep banner on; STRICT suppresses', () => {
    expect(TaxModeService.shouldShowDraftBanner('OFF')).toBe(true);
    expect(TaxModeService.shouldShowDraftBanner('AUDIT')).toBe(true);
    expect(TaxModeService.shouldShowDraftBanner('STRICT')).toBe(false);
  });
});
