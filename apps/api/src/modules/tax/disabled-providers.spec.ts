// MVP-launch defer — regression coverage for the `disabled` GST-compliance
// providers and the service-level deferral they drive.
//
// Context: production (NODE_ENV=production) refuses the `stub` e-way-bill /
// e-invoice / GSTN providers because they forge IRN/EWB/GSTIN-verified
// signals (CGST §122 fraud). For an MVP launch without NIC GSP / GSTN
// credentials we select `disabled`, which:
//   • boots cleanly (the factory returns a provider instead of throwing),
//   • mints NOTHING (generate/cancel refuse if ever reached),
//   • makes the services report the feature off so generation is skipped and
//     dispatch (canShip) is not blocked,
//   • for GSTN, returns found=false/UNKNOWN — never a false "verified".
//
// These tests would fail if a future change made `disabled` mint a document,
// throw at boot, or block shipping.

import { DisabledEWayBillProvider } from './infrastructure/eway-bill/disabled-eway-bill-provider';
import { EWayBillProviderError } from './infrastructure/eway-bill/eway-bill-provider';
import { DisabledEInvoiceProvider } from './infrastructure/einvoice/disabled-einvoice-provider';
import { EInvoiceProviderError } from './infrastructure/einvoice/einvoice-provider';
import { DisabledGstnProvider } from './infrastructure/gstn/disabled-gstn-provider';
import { EWayBillService } from './application/services/eway-bill.service';
import { EInvoiceService } from './application/services/einvoice.service';

describe('Disabled GST-compliance providers (MVP-launch defer)', () => {
  describe('DisabledEWayBillProvider — mints nothing, refuses if called', () => {
    const p = new DisabledEWayBillProvider();

    it('has the stable name "disabled" (persisted on rows / audit trail)', () => {
      expect(p.name).toBe('disabled');
    });

    it('generate() throws a non-retryable PERMANENT error (no EWB minted)', async () => {
      await expect(p.generate({} as any)).rejects.toBeInstanceOf(
        EWayBillProviderError,
      );
      await p.generate({} as any).catch((e: EWayBillProviderError) => {
        expect(e.category).toBe('PERMANENT');
        expect(e.retryable).toBe(false);
      });
    });

    it('cancel() and updatePartB() also refuse', async () => {
      await expect(p.cancel({} as any)).rejects.toBeInstanceOf(
        EWayBillProviderError,
      );
      await expect(p.updatePartB({} as any)).rejects.toBeInstanceOf(
        EWayBillProviderError,
      );
    });
  });

  describe('DisabledEInvoiceProvider — mints nothing, refuses if called', () => {
    const p = new DisabledEInvoiceProvider();

    it('has the stable name "disabled"', () => {
      expect(p.name).toBe('disabled');
    });

    it('generate() throws a non-retryable PERMANENT error (no IRN minted)', async () => {
      await expect(p.generate({} as any)).rejects.toBeInstanceOf(
        EInvoiceProviderError,
      );
      await p.generate({} as any).catch((e: EInvoiceProviderError) => {
        expect(e.category).toBe('PERMANENT');
        expect(e.retryable).toBe(false);
      });
    });

    it('cancel() also refuses', async () => {
      await expect(p.cancel({} as any)).rejects.toBeInstanceOf(
        EInvoiceProviderError,
      );
    });
  });

  describe('DisabledGstnProvider — claims nothing, never throws', () => {
    const p = new DisabledGstnProvider();

    it('has the stable name "disabled"', () => {
      expect(p.name).toBe('disabled');
    });

    it('verify() returns found=false / UNKNOWN (never a false "verified")', async () => {
      const result = await p.verify({ gstin: '29ABCDE1234F1Z5' });
      expect(result.found).toBe(false);
      expect(result.status).toBe('UNKNOWN');
      expect(result.legalName).toBeNull();
      expect(result.registrationType).toBeNull();
    });
  });

  describe('EWayBillService defers when provider is disabled', () => {
    const disabledProvider = new DisabledEWayBillProvider();

    it('isEnabled() returns false WITHOUT reading the tax-config flag', async () => {
      const taxConfig = { getBoolean: jest.fn() } as any;
      const svc = new EWayBillService({} as any, taxConfig, disabledProvider);
      await expect(svc.isEnabled()).resolves.toBe(false);
      // Boot-layer disable takes precedence — no config read.
      expect(taxConfig.getBoolean).not.toHaveBeenCalled();
    });

    it('canShip() allows dispatch WITHOUT querying EWB rows (operator handles EWB manually)', async () => {
      const taxConfig = { getBoolean: jest.fn() } as any;
      const prisma = {
        eWayBill: { findFirst: jest.fn() },
      } as any;
      const svc = new EWayBillService(prisma, taxConfig, disabledProvider);
      const decision = await svc.canShip('sub-1');
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toMatch(/disabled/i);
      // Short-circuits before touching the EWB table.
      expect(prisma.eWayBill.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('EInvoiceService defers when provider is disabled', () => {
    it('isEnabled() returns false even when the einvoice_enabled flag is true', async () => {
      const disabledProvider = new DisabledEInvoiceProvider();
      // taxConfig says enabled=true; the disabled provider must still win.
      const taxConfig = {
        getBoolean: jest.fn().mockResolvedValue(true),
      } as any;
      const svc = new EInvoiceService(
        {} as any,
        {} as any,
        disabledProvider,
        undefined,
        taxConfig,
      );
      await expect(svc.isEnabled()).resolves.toBe(false);
      expect(taxConfig.getBoolean).not.toHaveBeenCalled();
    });
  });
});
