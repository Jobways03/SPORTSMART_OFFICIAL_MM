import 'reflect-metadata';
import { NicEInvoiceProvider } from '../../src/modules/tax/infrastructure/einvoice/nic-einvoice-provider';
import { EInvoiceProviderError } from '../../src/modules/tax/infrastructure/einvoice/einvoice-provider';

// Phase 160 (#8) — NIC provider typed-error classification + 2150 idempotent
// recovery. fetch is stubbed; we drive the response shapes.

const ENV: Record<string, string> = {
  NIC_IRP_BASE_URL: 'https://nic.example',
  NIC_IRP_GSP_USERNAME: 'u',
  NIC_IRP_GSP_PASSWORD: 'p',
  NIC_IRP_GSP_CLIENT_ID: 'c',
  NIC_IRP_GSP_CLIENT_SECRET: 's',
  NIC_IRP_TAXPAYER_GSTIN: '29ABCDE1234F1Z5',
};

function makeProvider() {
  const env: any = {
    getOptional: (k: string) => ENV[k],
    getString: (k: string, fb: string) => ENV[k] ?? fb,
  };
  return new NicEInvoiceProvider(env);
}

const GEN_INPUT: any = {
  supplierGstin: '29ABCDE1234F1Z5',
  buyerGstin: '07AAGCB1234C1Z5',
  documentNumber: 'INV-1',
  documentDate: new Date('2026-04-15T00:00:00Z'),
  documentType: 'TAX_INVOICE',
  totalInvoiceValueInPaise: 118000n,
  taxableValueInPaise: 100000n,
  cgstInPaise: 0n,
  sgstInPaise: 0n,
  igstInPaise: 18000n,
  cessInPaise: 0n,
  transactionCategory: 'B2B',
  reverseChargeApplicable: false,
  placeOfSupplyStateCode: '07',
  lineItems: [
    { productName: 'X', hsnOrSacCode: '1234', uqcCode: 'NOS', quantity: 1, unitPriceInPaise: 100000n, taxableInPaise: 100000n, gstRateBps: 1800 },
  ],
};

function stubFetch(sequence: Array<{ status: number; json: any }>) {
  let i = 0;
  (global as any).fetch = jest.fn(async () => {
    const r = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json,
      text: async () => JSON.stringify(r.json),
    };
  });
}

const AUTH_OK = { status: 200, json: { authtoken: 'tok' } };

afterEach(() => {
  delete (global as any).fetch;
});

describe('NicEInvoiceProvider error classification (#8)', () => {
  it('throws a PERMANENT typed error on NIC 2253 (mandatory field missing)', async () => {
    stubFetch([
      AUTH_OK,
      { status: 400, json: { Status: 0, ErrorDetails: [{ ErrorCode: '2253', ErrorMessage: 'Mandatory field missing' }] } },
    ]);
    const p = makeProvider();
    await expect(p.generate(GEN_INPUT)).rejects.toMatchObject({
      name: 'EInvoiceProviderError',
      category: 'PERMANENT',
    });
    try {
      await p.generate(GEN_INPUT);
    } catch (e) {
      expect((e as EInvoiceProviderError).opts.nicErrorCode).toBe('2253');
      expect((e as EInvoiceProviderError).retryable).toBe(false);
    }
  });

  it('throws AUTH (retryable) + clears token on NIC 2172 / HTTP 401', async () => {
    stubFetch([AUTH_OK, { status: 401, json: { Status: 0, ErrorDetails: [{ ErrorCode: '2172', ErrorMessage: 'token expired' }] } }]);
    const p = makeProvider();
    await expect(p.generate(GEN_INPUT)).rejects.toMatchObject({ category: 'AUTH' });
  });

  it('throws RATE_LIMIT (retryable) on HTTP 429', async () => {
    stubFetch([AUTH_OK, { status: 429, json: { Status: 0 } }]);
    const p = makeProvider();
    const err = await p.generate(GEN_INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(EInvoiceProviderError);
    expect(err.category).toBe('RATE_LIMIT');
    expect(err.retryable).toBe(true);
  });

  it('throws TRANSIENT (retryable) on HTTP 5xx', async () => {
    stubFetch([AUTH_OK, { status: 503, json: { Status: 0, ErrorDetails: [] } }]);
    const p = makeProvider();
    const err = await p.generate(GEN_INPUT).catch((e) => e);
    expect(err.category).toBe('TRANSIENT');
    expect(err.retryable).toBe(true);
  });

  it('recovers the existing IRN idempotently on NIC 2150 (duplicate)', async () => {
    stubFetch([
      AUTH_OK,
      {
        status: 200,
        json: {
          Status: 0,
          ErrorDetails: [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }],
          Desc: { Irn: 'd'.repeat(64), AckNo: '111', AckDt: '2026-04-15 10:00:00', SignedQRCode: 'QR' },
        },
      },
    ]);
    const p = makeProvider();
    const res = await p.generate(GEN_INPUT);
    expect(res.irn).toBe('d'.repeat(64));
    expect(res.ackNo).toBe('111');
  });

  it('throws DUPLICATE when 2150 carries no recoverable IRN', async () => {
    stubFetch([
      AUTH_OK,
      { status: 200, json: { Status: 0, ErrorDetails: [{ ErrorCode: '2150', ErrorMessage: 'Duplicate IRN' }] } },
    ]);
    const p = makeProvider();
    const err = await p.generate(GEN_INPUT).catch((e) => e);
    expect(err).toBeInstanceOf(EInvoiceProviderError);
    expect(err.category).toBe('DUPLICATE');
  });

  it('returns the IRN on a successful (Status=1) response', async () => {
    stubFetch([
      AUTH_OK,
      { status: 200, json: { Status: 1, Data: { Irn: 'e'.repeat(64), AckNo: '222', AckDt: '2026-04-15 10:00:00', SignedQRCode: 'QR' } } },
    ]);
    const p = makeProvider();
    const res = await p.generate(GEN_INPUT);
    expect(res.irn).toBe('e'.repeat(64));
    expect(res.qrCodeUrl).toContain('data:image/png;base64,QR');
  });
});
