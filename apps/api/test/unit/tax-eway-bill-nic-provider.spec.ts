import 'reflect-metadata';
import { NicEWayBillProvider } from '../../src/modules/tax/infrastructure/eway-bill/nic-eway-bill-provider';
import { EWayBillProviderError } from '../../src/modules/tax/infrastructure/eway-bill/eway-bill-provider';

// Phase 160 (#11) — NIC EWB provider typed-error classification.

const ENV: Record<string, string> = {
  NIC_API_BASE_URL: 'https://nic.example',
  NIC_GSP_USERNAME: 'u',
  NIC_GSP_PASSWORD: 'p',
  NIC_GSP_CLIENT_ID: 'c',
  NIC_GSP_CLIENT_SECRET: 's',
  NIC_TAXPAYER_GSTIN: '29ABCDE1234F1Z5',
};

function makeProvider() {
  const env: any = {
    getOptional: (k: string) => ENV[k],
    getString: (k: string, fb: string) => ENV[k] ?? fb,
  };
  return new NicEWayBillProvider(env);
}

const GEN: any = {
  supplierGstin: '29ABCDE1234F1Z5',
  invoiceDocumentNumber: 'INV-1',
  invoiceDate: new Date('2026-04-15T00:00:00Z'),
  fromPincode: '560001',
  fromStateCode: '29',
  toPincode: '560002',
  toStateCode: '29',
  distanceKm: 12,
  consignmentValueInPaise: 200000n,
  transportMode: 'ROAD',
  vehicleNumber: 'KA01AB1234',
  transporterId: null,
  transporterName: null,
  items: [
    { productName: 'X', hsnOrSacCode: '1234', quantity: 1, uqcCode: 'NOS', taxableAmountInPaise: 200000n, gstRateBps: 1800 },
  ],
};

function stubFetch(seq: Array<{ status: number; json: any }>) {
  let i = 0;
  (global as any).fetch = jest.fn(async () => {
    const r = seq[Math.min(i, seq.length - 1)];
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
afterEach(() => delete (global as any).fetch);

describe('NicEWayBillProvider error classification (#11)', () => {
  it('PERMANENT on a 4xx data error (invalid vehicle)', async () => {
    stubFetch([AUTH_OK, { status: 400, json: { status_cd: '0', error: { errorCodes: '238' } } }]);
    const err = await makeProvider().generate(GEN).catch((e) => e);
    expect(err).toBeInstanceOf(EWayBillProviderError);
    expect(err.category).toBe('PERMANENT');
    expect(err.opts.nicErrorCode).toBe('238');
    expect(err.retryable).toBe(false);
  });

  it('AUTH (retryable) on HTTP 401', async () => {
    stubFetch([AUTH_OK, { status: 401, json: { status_cd: '0', error: 'token expired' } }]);
    const err = await makeProvider().generate(GEN).catch((e) => e);
    expect(err.category).toBe('AUTH');
    expect(err.retryable).toBe(true);
  });

  it('RATE_LIMIT (retryable) on HTTP 429', async () => {
    stubFetch([AUTH_OK, { status: 429, json: { status_cd: '0' } }]);
    const err = await makeProvider().generate(GEN).catch((e) => e);
    expect(err.category).toBe('RATE_LIMIT');
  });

  it('TRANSIENT (retryable) on HTTP 5xx', async () => {
    stubFetch([AUTH_OK, { status: 503, json: { status_cd: '0' } }]);
    const err = await makeProvider().generate(GEN).catch((e) => e);
    expect(err.category).toBe('TRANSIENT');
  });

  it('returns the EWB number on a successful (status_cd=1) response', async () => {
    stubFetch([
      AUTH_OK,
      { status: 200, json: { status_cd: '1', data: { ewayBillNo: 123456789012, ewayBillDate: '15/04/2026 10:00:00', validUpto: '16/04/2026 10:00:00' } } },
    ]);
    const res = await makeProvider().generate(GEN);
    expect(res.ewbNumber).toBe('123456789012');
  });
});
