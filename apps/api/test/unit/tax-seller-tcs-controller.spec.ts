import 'reflect-metadata';
import { SellerTcsController } from '../../src/modules/tax/presentation/controllers/seller-tcs.controller';

// Phase 160 (§52 TCS lifecycle audit B2 / #2) — seller-facing TCS API.
//
// Focus: seller scoping + the certificate ownership guards (a seller
// must never reach another seller's document, and can only pull issued
// certificates — not drafts).

function makeController() {
  const tcs = {
    listForSeller: jest.fn(),
    getLedgerOwner: jest.fn(),
    renderCertificateHtml: jest.fn(),
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const controller = new SellerTcsController(tcs as any, audit as any);
  return { controller, tcs, audit };
}

function makeRes() {
  return { setHeader: jest.fn(), send: jest.fn() } as any;
}

const req = { sellerId: 'seller-1', ip: '1.2.3.4', headers: {} } as any;

const baseRow = {
  id: 'l-1',
  filingPeriod: '2026-04',
  status: 'CERTIFICATE_ISSUED',
  supplierGstin: '29ABCDE1234F1Z5',
  grossTaxableSupplyInPaise: 1_000_000n,
  netTaxableSupplyInPaise: 1_000_000n,
  cgstTcsInPaise: 5_000n,
  sgstTcsInPaise: 5_000n,
  igstTcsInPaise: 0n,
  totalTcsInPaise: 10_000n,
  tcsRateBps: 100,
  nicArn: 'AA1234567890123',
  certificateNumber: 'TCS/2026-04/ABC',
  certificateIssuedAt: new Date('2026-05-02T00:00:00Z'),
  computedAt: new Date('2026-05-01T00:00:00Z'),
};

describe('SellerTcsController.summary', () => {
  it('scopes the query to the authenticated seller + serialises BigInt', async () => {
    const { controller, tcs } = makeController();
    tcs.listForSeller.mockResolvedValue([baseRow]);
    const r = await controller.summary(req, '2026-04');
    expect(tcs.listForSeller).toHaveBeenCalledWith({
      sellerId: 'seller-1',
      filingPeriod: '2026-04',
    });
    expect(r.data.items[0].totalTcsInPaise).toBe('10000');
    expect(typeof r.data.items[0].totalTcsInPaise).toBe('string');
  });

  it('rejects a malformed filingPeriod', async () => {
    const { controller } = makeController();
    await expect(controller.summary(req, '2026/04')).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('SellerTcsController.certificates', () => {
  it('returns only CERTIFICATE_ISSUED rows with a download link', async () => {
    const { controller, tcs } = makeController();
    tcs.listForSeller.mockResolvedValue([
      baseRow,
      { ...baseRow, id: 'l-2', status: 'FILED', certificateNumber: null },
    ]);
    const r = await controller.certificates(req);
    expect(r.data.items).toHaveLength(1);
    expect(r.data.items[0].id).toBe('l-1');
    expect(r.data.items[0].downloadUrl).toBe(
      '/seller/tax/tcs/certificates/l-1.html',
    );
  });
});

describe('SellerTcsController.downloadCertificate', () => {
  it('serves the HTML for the seller own issued certificate + audits it', async () => {
    const { controller, tcs, audit } = makeController();
    tcs.getLedgerOwner.mockResolvedValue({
      id: 'l-1',
      sellerId: 'seller-1',
      status: 'CERTIFICATE_ISSUED',
    });
    tcs.renderCertificateHtml.mockResolvedValue('<html>cert</html>');
    const res = makeRes();
    await controller.downloadCertificate(req, res, 'l-1');
    expect(res.send).toHaveBeenCalledWith('<html>cert</html>');
    expect(audit.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog.mock.calls[0][0].action).toBe(
      'tax.tcs.certificateDownloaded',
    );
  });

  it('403s when the row belongs to a different seller (no cross-seller leak)', async () => {
    const { controller, tcs } = makeController();
    tcs.getLedgerOwner.mockResolvedValue({
      id: 'l-1',
      sellerId: 'OTHER-seller',
      status: 'CERTIFICATE_ISSUED',
    });
    const res = makeRes();
    await expect(
      controller.downloadCertificate(req, res, 'l-1'),
    ).rejects.toMatchObject({ status: 403 });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('404s when the ledger row does not exist', async () => {
    const { controller, tcs } = makeController();
    tcs.getLedgerOwner.mockResolvedValue(null);
    const res = makeRes();
    await expect(
      controller.downloadCertificate(req, res, 'ghost'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('404s when the row is owned but the certificate is not yet issued', async () => {
    const { controller, tcs } = makeController();
    tcs.getLedgerOwner.mockResolvedValue({
      id: 'l-1',
      sellerId: 'seller-1',
      status: 'PAID_TO_GOVT',
    });
    const res = makeRes();
    await expect(
      controller.downloadCertificate(req, res, 'l-1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(tcs.renderCertificateHtml).not.toHaveBeenCalled();
  });
});
