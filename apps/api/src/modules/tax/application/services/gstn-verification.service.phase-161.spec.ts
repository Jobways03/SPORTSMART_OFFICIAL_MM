// Phase 161 — Seller GSTIN Verification flow audit remediation coverage.
// Behavioural proof of each finding:
//   B1  legalNameMismatch persisted as a queryable column
//   B2  verifiedAt set ONLY on success; lastCheckedAt always; failure no-leak
//   B3  SellerGstin.isVerified set (= found && ACTIVE)
//   B4  verificationNotes appended + GstinVerificationEvent history row
//   B5  gstnRawResponseJson / gstnPortalStatus / lastVerifiedProvider persisted
//   #8  AuditPublicFacade row + lifecycle event
//   #11 fuzzy legal-name match (PVT LTD ≈ Private Limited)
//   #13 re-verify cooldown returns cached (no provider call)
//   #14 transient provider failure retried then captured (not thrown)
//   #18 customer flow parity

import {
  GstnVerificationService,
  GSTN_VERIFICATION_EVENTS,
  legalNamesMatch,
} from './gstn-verification.service';

function buildHarness(opts: any = {}) {
  let sellerRow: any = opts.sellerRow ?? null;
  let customerRow: any = opts.customerRow ?? null;
  const sellerGstin = {
    findUnique: jest.fn(async ({ where }: any) =>
      sellerRow && sellerRow.id === where.id ? { ...sellerRow } : null,
    ),
    update: jest.fn(async ({ data }: any) => {
      sellerRow = { ...sellerRow, ...data };
      return sellerRow;
    }),
  };
  const customerTaxProfile = {
    findUnique: jest.fn(async ({ where }: any) =>
      customerRow && customerRow.id === where.id ? { ...customerRow } : null,
    ),
    update: jest.fn(async ({ data }: any) => {
      customerRow = { ...customerRow, ...data };
      return customerRow;
    }),
  };
  const gstinVerificationEvent = { create: jest.fn(async (_a: any) => ({})) };
  const prisma: any = { sellerGstin, customerTaxProfile, gstinVerificationEvent };
  const provider: any = {
    name: opts.providerName ?? 'stub',
    verify: jest.fn(
      opts.verify ??
        (async (_i: any) => ({
          found: true,
          legalName: 'Stub Taxpayer 1234',
          stateCode: '29',
          registrationType: 'REGULAR',
          status: 'ACTIVE',
          rawResponse: { provider: 'stub', ok: true },
        })),
    ),
  };
  const audit: any = { writeAuditLog: jest.fn(async () => undefined) };
  const env: any = { getNumber: jest.fn((_k: string, d: number) => opts.cooldownHours ?? d) };
  const eventBus: any = { publish: jest.fn(async (_e: any) => undefined) };
  const svc = new GstnVerificationService(prisma, provider, audit, env, eventBus);
  return { svc, prisma, sellerGstin, customerTaxProfile, gstinVerificationEvent, provider, audit, env, eventBus };
}

function sellerRow(over: any = {}) {
  return {
    id: 'sg-1',
    gstin: '29ABCDE1234F1Z5',
    legalName: 'Stub Taxpayer 1234',
    isVerified: false,
    verifiedAt: null,
    lastCheckedAt: null,
    verificationNotes: null,
    legalNameMismatch: false,
    gstLegalName: null,
    gstnPortalStatus: null,
    ...over,
  };
}

describe('GstnVerificationService.verifySellerGstin (Phase 161)', () => {
  it('B1/B2/B3/B5/#8: ACTIVE → isVerified, verifiedAt + lastCheckedAt, columns, audit, event', async () => {
    const { svc, sellerGstin, gstinVerificationEvent, audit, eventBus } = buildHarness({
      sellerRow: sellerRow(),
    });
    const res = await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    expect(res.verified).toBe(true);
    const data = sellerGstin.update.mock.calls[0]![0].data;
    expect(data.isVerified).toBe(true);
    expect(data.verifiedAt).toBeInstanceOf(Date);
    expect(data.lastCheckedAt).toBeInstanceOf(Date);
    expect(data.gstLegalName).toBe('Stub Taxpayer 1234'); // B1 portal name
    expect(data.gstnPortalStatus).toBe('ACTIVE'); // B5
    expect(data.gstnRawResponseJson).toBeDefined(); // B5
    expect(data.lastVerifiedProvider).toBe('stub'); // B5
    expect(data.legalNameMismatch).toBe(false); // B1
    expect(data.verificationFailureReason).toBeNull();
    // B4 — history event row
    expect(gstinVerificationEvent.create.mock.calls[0]![0].data.verified).toBe(true);
    // #8 — audit + bus
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: GSTN_VERIFICATION_EVENTS.VERIFIED, module: 'tax-master' }),
    );
    expect(eventBus.publish).toHaveBeenCalled();
  });

  it('B2: NOT_FOUND → not verified, verifiedAt NOT set, lastCheckedAt set, failure reason', async () => {
    const { svc, sellerGstin } = buildHarness({
      sellerRow: sellerRow(),
      verify: async () => ({ found: false, legalName: null, stateCode: null, registrationType: null, status: 'UNKNOWN', rawResponse: {} }),
    });
    const res = await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    expect(res.verified).toBe(false);
    const data = sellerGstin.update.mock.calls[0]![0].data;
    expect(data.isVerified).toBe(false);
    expect(data.verifiedAt).toBeNull(); // preserved (was null) — NOT stamped on failure
    expect(data.lastCheckedAt).toBeInstanceOf(Date);
    expect(data.verificationFailureReason).toMatch(/not found/i);
  });

  it('B2: SUSPENDED (found, not ACTIVE) → not verified, preserves prior verifiedAt', async () => {
    const prior = new Date('2026-04-01T00:00:00.000Z');
    const { svc, sellerGstin } = buildHarness({
      sellerRow: sellerRow({ isVerified: true, verifiedAt: prior }),
      verify: async () => ({ found: true, legalName: 'Stub Taxpayer 1234', stateCode: '29', registrationType: 'REGULAR', status: 'SUSPENDED', rawResponse: {} }),
    });
    await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    const data = sellerGstin.update.mock.calls[0]![0].data;
    expect(data.isVerified).toBe(false);
    expect(data.verifiedAt).toEqual(prior); // last SUCCESS preserved
    expect(data.verificationFailureReason).toMatch(/SUSPENDED/);
  });

  it('B1: legal-name mismatch is persisted as a queryable flag', async () => {
    const { svc, sellerGstin, eventBus } = buildHarness({
      sellerRow: sellerRow({ legalName: 'Acme Corp' }),
      verify: async () => ({ found: true, legalName: 'Totally Different Name', stateCode: '29', registrationType: 'REGULAR', status: 'ACTIVE', rawResponse: {} }),
    });
    const res = await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    expect(res.legalNameMismatch).toBe(true);
    expect(sellerGstin.update.mock.calls[0]![0].data.legalNameMismatch).toBe(true);
    const events = eventBus.publish.mock.calls.map((c: any) => c[0].eventName);
    expect(events).toContain(GSTN_VERIFICATION_EVENTS.MISMATCH);
  });

  it('#11: abbreviation variation is NOT flagged a mismatch', async () => {
    const { svc, sellerGstin } = buildHarness({
      sellerRow: sellerRow({ legalName: 'ACME PVT LTD' }),
      verify: async () => ({ found: true, legalName: 'Acme Private Limited', stateCode: '29', registrationType: 'REGULAR', status: 'ACTIVE', rawResponse: {} }),
    });
    const res = await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    expect(res.legalNameMismatch).toBe(false);
    expect(sellerGstin.update.mock.calls[0]![0].data.legalNameMismatch).toBe(false);
  });

  it('B4: verificationNotes appended (prior history retained)', async () => {
    const { svc, sellerGstin } = buildHarness({
      sellerRow: sellerRow({ verificationNotes: '[2026-04-01] provider=stub found=true status=ACTIVE' }),
    });
    await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    const notes = sellerGstin.update.mock.calls[0]![0].data.verificationNotes as string;
    expect(notes).toContain('2026-04-01'); // prior line retained
    expect(notes.split('\n').length).toBeGreaterThanOrEqual(2); // appended
  });

  it('#13: cooldown returns cached result without calling the provider', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const { svc, provider, sellerGstin } = buildHarness({
      sellerRow: sellerRow({ isVerified: true, lastCheckedAt: recent, gstnPortalStatus: 'ACTIVE' }),
      cooldownHours: 24,
    });
    const res = await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    expect(res.cached).toBe(true);
    expect(provider.verify).not.toHaveBeenCalled();
    expect(sellerGstin.update).not.toHaveBeenCalled();
  });

  it('#13: force=true bypasses the cooldown', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    const { svc, provider } = buildHarness({
      sellerRow: sellerRow({ lastCheckedAt: recent }),
      cooldownHours: 24,
    });
    await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1', force: true });
    expect(provider.verify).toHaveBeenCalledTimes(1);
  });

  it('#14: transient provider failure is retried then captured (not thrown)', async () => {
    const { svc, provider, sellerGstin } = buildHarness({
      sellerRow: sellerRow(),
      verify: async () => {
        throw new Error('network blip');
      },
    });
    const res = await svc.verifySellerGstin({ sellerGstinId: 'sg-1', actorId: 'admin-1' });
    expect(res.verified).toBe(false);
    expect(provider.verify).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(sellerGstin.update.mock.calls[0]![0].data.verificationFailureReason).toMatch(/network blip/);
  });
});

describe('GstnVerificationService.verifyCustomerTaxProfile (Phase 161 #18)', () => {
  it('ACTIVE → isVerified + columns persisted', async () => {
    const { svc, customerTaxProfile, gstinVerificationEvent } = buildHarness({
      customerRow: { id: 'cp-1', gstin: '29ABCDE1234F1Z5', legalName: 'Stub Taxpayer 1234', isVerified: false, verifiedAt: null, lastCheckedAt: null, verificationNotes: null, legalNameMismatch: false, gstLegalName: null, gstnPortalStatus: null },
    });
    const res = await svc.verifyCustomerTaxProfile({ profileId: 'cp-1', actorId: 'admin-1' });
    expect(res.verified).toBe(true);
    const data = customerTaxProfile.update.mock.calls[0]![0].data;
    expect(data.isVerified).toBe(true);
    expect(data.gstnPortalStatus).toBe('ACTIVE');
    expect(data.lastVerifiedProvider).toBe('stub');
    expect(gstinVerificationEvent.create.mock.calls[0]![0].data.targetType).toBe('CUSTOMER_TAX_PROFILE');
  });
});

describe('legalNamesMatch (#11)', () => {
  it('matches abbreviation + punctuation + casing variants', () => {
    expect(legalNamesMatch('ACME PVT LTD', 'Acme Private Limited')).toBe(true);
    expect(legalNamesMatch('ACME PVT. LTD.', 'Acme Pvt Ltd')).toBe(true);
    expect(legalNamesMatch('Foo & Sons Co', 'Foo and Sons Company')).toBe(true);
  });
  it('flags genuinely different names', () => {
    expect(legalNamesMatch('Acme Corp', 'Beta Industries')).toBe(false);
  });
});
