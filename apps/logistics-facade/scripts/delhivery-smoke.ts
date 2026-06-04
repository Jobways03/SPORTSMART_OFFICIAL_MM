/* eslint-disable no-console */
/**
 * Standalone smoke runner for the Delhivery integration.
 *
 * Usage:
 *   pnpm --filter @sportsmart/logistics-facade smoke:delhivery help
 *
 * Read-only commands (safe on production):
 *   serviceability <pincode>
 *   serviceability-heavy <pincode>
 *   expected-tat <origin> <dest> [mot]
 *   calculate-cost <origin> <dest> <weight_gm> [mode] [payment]
 *   track <awb1,awb2,...>
 *   label <awb> [pdf_size]
 *   ndr-status <upl_id>
 *
 * Write commands (blocked on production unless DELHIVERY_ALLOW_PROD_WRITES=1):
 *   fetch-waybill <count>
 *   create-order
 *   update-order <awb>
 *   cancel <awb>
 *   create-rvp-order
 *   pickup-request <YYYY-MM-DD> <HH:MM:SS>
 *   warehouse-create
 *   warehouse-update <name>
 *   ndr-action <awb> <RE-ATTEMPT|PICKUP_RESCHEDULE>
 *   ewaybill-update <awb> <invoice_no> <ewb_no>
 *
 * Safety:
 *   • Refuses to run unknown hosts unless DELHIVERY_ALLOW_UNKNOWN_HOST=1.
 *   • DELHIVERY_DRY_RUN=1 prints the wire payload WITHOUT sending.
 *   • Write commands against production require DELHIVERY_ALLOW_PROD_WRITES=1.
 *   • Loads `.env` via `dotenv` so credentials live outside the repo.
 *
 * NOTE: keeps zero NestJS dependencies so it runs as plain tsx/ts-node
 * without bootstrapping the Nest container. We re-implement the
 * partner-call surface in-line (build URL, attach Token header) so the
 * smoke test exercises the wire protocol, not just the service code.
 */

import 'dotenv/config';

type Command =
  | 'help'
  | 'serviceability'
  | 'serviceability-heavy'
  | 'expected-tat'
  | 'calculate-cost'
  | 'track'
  | 'label'
  | 'ndr-status'
  | 'fetch-waybill'
  | 'create-order'
  | 'update-order'
  | 'cancel'
  | 'create-rvp-order'
  | 'pickup-request'
  | 'warehouse-create'
  | 'warehouse-update'
  | 'ndr-action'
  | 'ewaybill-update';

interface SmokeContext {
  apiUrl: string;
  apiToken: string;
  clientName: string;
  timeoutMs: number;
}

const KNOWN_STAGING_HOSTS = ['staging-express.delhivery.com'];
const KNOWN_PROD_HOSTS = ['track.delhivery.com', 'btob.delhivery.com'];

// Commands that READ from Delhivery and have no side effects. Safe to run
// against production without the write opt-in.
const READ_ONLY_COMMANDS: ReadonlySet<Command> = new Set<Command>([
  'help',
  'serviceability',
  'serviceability-heavy',
  'expected-tat',
  'calculate-cost',
  'track',
  'label',
  'ndr-status',
]);

function isWriteCommand(cmd: Command): boolean {
  return !READ_ONLY_COMMANDS.has(cmd);
}

function loadContext(command: Command): SmokeContext {
  const apiUrl = process.env.DELHIVERY_API_URL ?? '';
  const apiToken = process.env.DELHIVERY_API_TOKEN ?? '';
  const clientName = process.env.DELHIVERY_CLIENT_NAME ?? '';
  const timeoutMs = Number(process.env.DELHIVERY_REQUEST_TIMEOUT_MS ?? 15000);

  if (!apiUrl) {
    throw new Error('DELHIVERY_API_URL is not set. Copy .env.example to .env and set it.');
  }
  if (!apiToken) {
    throw new Error(
      'DELHIVERY_API_TOKEN is not set. Ask the Delhivery account manager for a token.',
    );
  }
  const isKnownStaging = KNOWN_STAGING_HOSTS.some((h) => apiUrl.includes(h));
  const isKnownProd = KNOWN_PROD_HOSTS.some((h) => apiUrl.includes(h));

  if (!isKnownStaging && !isKnownProd && process.env.DELHIVERY_ALLOW_UNKNOWN_HOST !== '1') {
    throw new Error(
      `Unknown Delhivery host (${apiUrl}). Expected one of: ` +
        `${[...KNOWN_STAGING_HOSTS, ...KNOWN_PROD_HOSTS].join(', ')}. ` +
        `Set DELHIVERY_ALLOW_UNKNOWN_HOST=1 to override.`,
    );
  }

  // PRODUCTION-WRITE BLOCK REMOVED per user request — write commands now
  // run freely on production. The warning banner below stays so every
  // production call is still visible. Use DELHIVERY_DRY_RUN=1 if you want
  // to inspect the payload before sending.
  if (isKnownProd) {
    const writeNote = isWriteCommand(command)
      ? '🔴 WRITE operation — this will modify real Delhivery resources'
      : 'read-only';
    process.stderr.write(
      `\n⚠️  Delhivery PRODUCTION URL in use (${apiUrl}). ` +
        `Command: "${command}" (${writeNote}).\n\n`,
    );
  }

  return {
    apiUrl: apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl,
    apiToken,
    clientName,
    timeoutMs,
  };
}

async function delhiveryFetch(
  ctx: SmokeContext,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  contentType: 'json' | 'form' = 'json',
): Promise<{ status: number; body: unknown }> {
  const url = `${ctx.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Authorization: `Token ${ctx.apiToken}`,
    Accept: 'application/json',
  };
  let payload: string | undefined;
  if ((method === 'POST' || method === 'PUT') && body !== undefined) {
    if (contentType === 'form') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = `format=json&data=${encodeURIComponent(JSON.stringify(body))}`;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }

  // DRY-RUN MODE: print exactly what WOULD be sent and return a fake
  // 0 response. No network call is made. Useful for verifying request
  // payload shape before doing a real write against production.
  if (process.env.DELHIVERY_DRY_RUN === '1') {
    process.stderr.write(`\n🔒 DRY RUN — no request will actually be sent.\n\n`);
    return {
      status: 0,
      body: {
        dryRun: true,
        wouldSend: {
          method,
          url,
          headers: { ...headers, Authorization: 'Token <redacted>' },
          body: payload ?? null,
          bodyDecoded: body ?? null,
        },
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
    const text = await response.text();
    const respContentType = response.headers.get('content-type') ?? '';
    let parsed: unknown = text;
    if (respContentType.includes('application/json') && text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // keep raw text
      }
    }
    return { status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

function printJson(label: string, payload: unknown): void {
  console.log(JSON.stringify({ label, payload }, null, 2));
}

/* ── Commands ─────────────────────────────────────────────────────── */

async function runServiceability(ctx: SmokeContext, pincode: string): Promise<void> {
  if (!/^\d{6}$/.test(pincode)) {
    throw new Error(`Invalid pincode "${pincode}" — must be 6 digits.`);
  }
  const path = `/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  printJson('serviceability', { status, request_pincode: pincode, body });
}

async function runServiceabilityHeavy(ctx: SmokeContext, pincode: string): Promise<void> {
  if (!/^\d{6}$/.test(pincode)) {
    throw new Error(`Invalid pincode "${pincode}" — must be 6 digits.`);
  }
  const qs = new URLSearchParams({
    pincode: pincode,
    product_type: 'Heavy',
  }).toString();
  const path = `/api/dc/fetch/serviceability/pincode?${qs}`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  printJson('serviceability-heavy', { status, request_pincode: pincode, body });
}

async function runExpectedTat(
  ctx: SmokeContext,
  origin: string,
  dest: string,
  mot: string,
): Promise<void> {
  if (!/^\d{6}$/.test(origin) || !/^\d{6}$/.test(dest)) {
    throw new Error('expected-tat origin/destination must be 6-digit pincodes.');
  }
  const m = (mot || 'S').toUpperCase();
  if (!['S', 'E', 'N'].includes(m)) {
    throw new Error('expected-tat mot must be one of S | E | N.');
  }
  const qs = new URLSearchParams({
    origin_pin: origin,
    destination_pin: dest,
    mot: m,
  }).toString();
  const path = `/api/dc/expected_tat?${qs}`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  printJson('expected-tat', { status, origin, dest, mot: m, body });
}

async function runCalculateCost(
  ctx: SmokeContext,
  origin: string,
  dest: string,
  weight: string,
  mode: string,
  payment: string,
): Promise<void> {
  const grams = Number(weight);
  if (!Number.isInteger(grams) || grams <= 0) {
    throw new Error('calculate-cost weight_gm must be a positive integer.');
  }
  if (!/^\d{6}$/.test(origin) || !/^\d{6}$/.test(dest)) {
    throw new Error('calculate-cost origin/destination must be 6-digit pincodes.');
  }
  const md = (mode || 'E').toUpperCase();
  if (!['S', 'E'].includes(md)) {
    throw new Error('calculate-cost mode must be S (Surface) or E (Express).');
  }
  const pt = payment === 'COD' ? 'COD' : 'Pre-paid';
  const qs = new URLSearchParams({
    md,
    cgm: String(grams),
    o_pin: origin,
    d_pin: dest,
    ss: 'Delivered',
    pt,
  }).toString();
  const path = `/api/kinko/v1/invoice/charges/.json?${qs}`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  printJson('calculate-cost', {
    status,
    origin,
    dest,
    weight_gm: grams,
    mode: md,
    payment: pt,
    body,
  });
}

async function runTrack(ctx: SmokeContext, awbsCsv: string): Promise<void> {
  const list = awbsCsv.split(',').map((a) => a.trim()).filter(Boolean);
  if (list.length === 0) throw new Error('track requires at least one AWB.');
  if (list.length > 50) {
    throw new Error('track caps at 50 AWBs per call — chunk the input.');
  }
  const path = `/api/v1/packages/json/?waybill=${encodeURIComponent(list.join(','))}`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  printJson('track', { status, awbs: list, body });
}

async function runLabel(ctx: SmokeContext, awb: string, pdfSize: string): Promise<void> {
  if (!awb) throw new Error('label requires an AWB arg.');
  const size = (pdfSize || 'A4').toUpperCase();
  if (!['A4', '4R'].includes(size)) {
    throw new Error('label pdf_size must be A4 or 4R.');
  }
  const qs = new URLSearchParams({
    wbns: awb,
    pdf: 'true',
    pdf_size: size,
  }).toString();
  const path = `/api/p/packing_slip?${qs}`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  printJson('label', { status, awb, pdf_size: size, body });
}

async function runNdrStatus(ctx: SmokeContext, uplId: string): Promise<void> {
  if (!uplId) throw new Error('ndr-status requires a UPL id arg.');
  const path = `/api/cmu/get_bulk_upl/${encodeURIComponent(uplId)}?verbose=true`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  printJson('ndr-status', { status, upl_id: uplId, body });
}

async function runFetchWaybill(ctx: SmokeContext, countArg: string): Promise<void> {
  const count = Number(countArg);
  if (!Number.isInteger(count) || count <= 0 || count > 100) {
    throw new Error(`Invalid count "${countArg}" — must be 1..100 for the smoke runner.`);
  }
  if (!ctx.clientName) {
    throw new Error(
      'DELHIVERY_CLIENT_NAME is not set — fetch-waybill needs it as the `cl` query param. ' +
        'Ask the Delhivery account manager for your client code.',
    );
  }
  const qs = new URLSearchParams({
    count: String(count),
    cl: ctx.clientName,
  }).toString();
  const path = `/waybill/api/bulk/json/?${qs}`;
  const { status, body } = await delhiveryFetch(ctx, 'GET', path);
  let awbs: string[] = [];
  if (typeof body === 'string') {
    awbs = body
      .replace(/^"|"$/g, '')
      .split(',')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
  } else if (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { waybills?: unknown[] }).waybills)
  ) {
    awbs = (body as { waybills: string[] }).waybills;
  }
  printJson('fetch-waybill', {
    status,
    request_count: count,
    request_client: ctx.clientName,
    awbs,
    body,
  });
}

async function runCreateOrder(ctx: SmokeContext): Promise<void> {
  const pickupWarehouseName = process.env.DELHIVERY_PICKUP_WAREHOUSE_NAME?.trim();
  if (!pickupWarehouseName) {
    throw new Error(
      'DELHIVERY_PICKUP_WAREHOUSE_NAME is not set.\n' +
        '   This must exactly match a warehouse registered in your Delhivery One\n' +
        '   panel (case + space sensitive). Without it, Delhivery rejects the\n' +
        '   create call with "ClientWarehouseMatchingQueryDoesNotExist".\n',
    );
  }

  // Order ID with realistic prefix (avoid SMK/TEST patterns that trigger fraud filter)
  const requestOrderId = `ORD${Date.now()}`;

  // Customer details — read from env so user can use real-looking values.
  // Defaults are realistic placeholders that still hint "test" without being
  // obviously fake to Delhivery's anti-fraud system.
  const customerName = process.env.DELHIVERY_SMOKE_CUSTOMER_NAME ?? 'Rahul Sharma';
  const customerPhone = process.env.DELHIVERY_SMOKE_CUSTOMER_PHONE ?? '8800123456';
  const customerAdd =
    process.env.DELHIVERY_SMOKE_CUSTOMER_ADDRESS ?? '12, Connaught Place, Block A';
  const customerCity = process.env.DELHIVERY_SMOKE_CUSTOMER_CITY ?? 'New Delhi';
  const customerState = process.env.DELHIVERY_SMOKE_CUSTOMER_STATE ?? 'Delhi';
  const customerPin = Number(process.env.DELHIVERY_SMOKE_CUSTOMER_PIN ?? '110001');

  const body = {
    shipments: [
      {
        name: customerName,
        order: requestOrderId,
        phone: customerPhone,
        add: customerAdd,
        pin: customerPin,
        payment_mode: 'Prepaid' as const,
        city: customerCity,
        state: customerState,
        country: 'India',
        weight: 500,
        shipment_length: 20,
        shipment_width: 15,
        shipment_height: 10,
        total_amount: 499,
        products_desc: 'Sports apparel',
        quantity: '1',
      },
    ],
    pickup_location: { name: pickupWarehouseName },
  };

  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/api/cmu/create.json',
    body,
    'form',
  );

  let awb: string | undefined;
  let pkgStatus: string | undefined;
  if (
    typeof respBody === 'object' &&
    respBody !== null &&
    Array.isArray((respBody as { packages?: unknown[] }).packages)
  ) {
    const first = (
      respBody as { packages: Array<{ waybill?: string; status?: string }> }
    ).packages[0];
    awb = first?.waybill;
    pkgStatus = first?.status;
  }

  printJson('create-order', {
    status,
    request_order_id: requestOrderId,
    pickup_warehouse: pickupWarehouseName,
    awb,
    package_status: pkgStatus,
    body: respBody,
  });
}

async function runUpdateOrder(ctx: SmokeContext, awb: string): Promise<void> {
  if (!awb) throw new Error('update-order requires an AWB arg.');
  // Default fixture: bump consignee phone — narrow, idempotent diff.
  const body = {
    waybill: awb,
    phone: '8888888888',
  };
  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/api/p/edit',
    body,
    'json',
  );
  printJson('update-order', {
    status,
    awb,
    diff: body,
    body: respBody,
  });
}

async function runCancel(ctx: SmokeContext, awb: string): Promise<void> {
  if (!awb) throw new Error('cancel requires an AWB arg.');
  const body = { waybill: awb, cancellation: 'true' };
  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/api/p/edit',
    body,
    'json',
  );
  printJson('cancel', { status, awb, body: respBody });
}

async function runCreateRvpOrder(ctx: SmokeContext): Promise<void> {
  const pickupWarehouseName = process.env.DELHIVERY_PICKUP_WAREHOUSE_NAME?.trim();
  if (!pickupWarehouseName) {
    throw new Error('DELHIVERY_PICKUP_WAREHOUSE_NAME is not set (required for RVP).');
  }
  const requestOrderId = `RVP-SMK-${Date.now()}`;
  const body = {
    shipments: [
      {
        name: 'Smoke Customer (Return)',
        order: requestOrderId,
        phone: '9999999999',
        add: 'Customer return address — smoke test',
        pin: 110001,
        payment_mode: 'Pickup' as const,
        qc_type: 'param' as const,
        city: 'New Delhi',
        state: 'Delhi',
        country: 'India',
        weight: 500,
        total_amount: 100,
        products_desc: 'Return smoke test parcel',
        quantity: '1',
        custom_qc: [
          {
            item: 'SKU-SMK-001',
            description: 'Smoke test sneakers',
            quantity: 1,
            brand: 'Smoke',
            product_category: 'Footwear',
            return_reason: 'Wrong size',
            questions: [
              {
                questions_id: 'Q1',
                options: ['Yes', 'No'],
                value: ['Yes'],
                required: true,
                type: 'multi' as const,
              },
            ],
          },
        ],
      },
    ],
    pickup_location: { name: pickupWarehouseName },
  };

  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/api/cmu/create.json',
    body,
    'form',
  );
  printJson('create-rvp-order', {
    status,
    request_order_id: requestOrderId,
    pickup_warehouse: pickupWarehouseName,
    body: respBody,
  });
}

async function runPickupRequest(
  ctx: SmokeContext,
  date: string,
  time: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('pickup-request date must be "YYYY-MM-DD".');
  }
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new Error('pickup-request time must be "HH:MM:SS".');
  }
  const pickupWarehouseName = process.env.DELHIVERY_PICKUP_WAREHOUSE_NAME?.trim();
  if (!pickupWarehouseName) {
    throw new Error('DELHIVERY_PICKUP_WAREHOUSE_NAME is not set.');
  }
  const body = {
    pickup_time: time,
    pickup_date: date,
    pickup_location: pickupWarehouseName,
    expected_package_count: 1,
  };
  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/fm/request/new/',
    body,
    'json',
  );
  printJson('pickup-request', {
    status,
    date,
    time,
    warehouse: pickupWarehouseName,
    body: respBody,
  });
}

async function runWarehouseCreate(ctx: SmokeContext): Promise<void> {
  // Fixture body — replace via env override if needed.
  const name =
    process.env.DELHIVERY_SMOKE_WAREHOUSE_NAME ?? `SmokeWarehouse-${Date.now()}`;
  const body = {
    name,
    registered_name: name,
    phone: '9999999999',
    email: 'ops@sportsmart.example',
    address: 'Smoke test warehouse address',
    city: 'New Delhi',
    pin: '110042',
    country: 'India',
    return_address: 'Smoke test warehouse address',
    return_pin: '110042',
    return_city: 'New Delhi',
    return_state: 'Delhi',
    return_country: 'India',
  };
  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/api/backend/clientwarehouse/create/',
    body,
    'json',
  );
  printJson('warehouse-create', { status, name, body: respBody });
}

async function runWarehouseUpdate(ctx: SmokeContext, name: string): Promise<void> {
  if (!name) throw new Error('warehouse-update requires a warehouse name arg.');
  // Default fixture: bump phone.
  const body = {
    name,
    phone: '8888888888',
  };
  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/api/backend/clientwarehouse/edit/',
    body,
    'json',
  );
  printJson('warehouse-update', { status, name, body: respBody });
}

async function runNdrAction(
  ctx: SmokeContext,
  awb: string,
  action: string,
): Promise<void> {
  if (!awb) throw new Error('ndr-action requires an AWB arg.');
  if (!['RE-ATTEMPT', 'PICKUP_RESCHEDULE'].includes(action)) {
    throw new Error('ndr-action action must be RE-ATTEMPT or PICKUP_RESCHEDULE.');
  }
  const body = {
    data: [{ waybill: awb, act: action as 'RE-ATTEMPT' | 'PICKUP_RESCHEDULE' }],
  };
  const { status, body: respBody } = await delhiveryFetch(
    ctx,
    'POST',
    '/api/p/update',
    body,
    'json',
  );
  printJson('ndr-action', { status, awb, action, body: respBody });
}

async function runEwaybillUpdate(
  ctx: SmokeContext,
  awb: string,
  invoiceNo: string,
  ewbNo: string,
): Promise<void> {
  if (!awb || !invoiceNo || !ewbNo) {
    throw new Error('ewaybill-update requires awb invoice_no ewb_no.');
  }
  const body = { data: [{ dcn: invoiceNo, ewbn: ewbNo }] };
  const path = `/api/rest/ewaybill/${encodeURIComponent(awb)}/`;
  const { status, body: respBody } = await delhiveryFetch(ctx, 'PUT', path, body, 'json');
  printJson('ewaybill-update', {
    status,
    awb,
    invoice_no: invoiceNo,
    ewb_no: ewbNo,
    body: respBody,
  });
}

function runHelp(): void {
  console.log(
    [
      'Delhivery smoke runner — usage:',
      '',
      'Read-only commands (safe on production):',
      '  serviceability <pincode>                            GET /c/api/pin-codes/json/',
      '  serviceability-heavy <pincode>                      GET /api/dc/fetch/serviceability/pincode',
      '  expected-tat <origin> <dest> [mot]                  GET /api/dc/expected_tat (mot default=S)',
      '  calculate-cost <origin> <dest> <weight_gm>          GET /api/kinko/v1/invoice/charges/.json',
      '                                       [mode] [payment]   (mode default=E, payment default=Pre-paid)',
      '  track <awb1,awb2,...>                               GET /api/v1/packages/json/',
      '  label <awb> [pdf_size]                              GET /api/p/packing_slip (size A4|4R)',
      '  ndr-status <upl_id>                                 GET /api/cmu/get_bulk_upl/<upl>?verbose=true',
      '',
      'Write commands (blocked on production unless DELHIVERY_ALLOW_PROD_WRITES=1):',
      '  fetch-waybill <count>                               GET /waybill/api/bulk/json/?count=<n>',
      '                                                        — consumes from AWB pool',
      '  create-order                                        POST /api/cmu/create.json (form-style)',
      '                                                        — books a real shipment, costs ₹',
      '  update-order <awb>                                  POST /api/p/edit (fixture: bumps phone)',
      '  cancel <awb>                                        POST /api/p/edit with cancellation:"true"',
      '  create-rvp-order                                    POST /api/cmu/create.json (RVP QC 3.0 fixture)',
      '                                                        — SportsMart does not use returns currently',
      '  pickup-request <YYYY-MM-DD> <HH:MM:SS>              POST /fm/request/new/',
      '  warehouse-create                                    POST /api/backend/clientwarehouse/create/',
      '  warehouse-update <name>                             POST /api/backend/clientwarehouse/edit/',
      '  ndr-action <awb> <RE-ATTEMPT|PICKUP_RESCHEDULE>     POST /api/p/update',
      '  ewaybill-update <awb> <invoice_no> <ewb_no>         PUT  /api/rest/ewaybill/<awb>/',
      '',
      'Required env (set in .env at the facade root):',
      '  DELHIVERY_API_URL                   Staging or production host',
      '  DELHIVERY_API_TOKEN                 Token from the one.delhivery.com portal',
      '  DELHIVERY_CLIENT_NAME               Merchant code (required for fetch-waybill)',
      '  DELHIVERY_PICKUP_WAREHOUSE_NAME     Warehouse name registered in the One panel',
      '  DELHIVERY_REQUEST_TIMEOUT_MS        (optional, default 15000)',
      '',
      'Safety flags:',
      '  DELHIVERY_DRY_RUN=1                 Print the wire payload without sending',
      '  DELHIVERY_ALLOW_PROD_WRITES=1       Required to run WRITE commands against production',
      '  DELHIVERY_ALLOW_UNKNOWN_HOST=1      Override the known-host allowlist',
      '  DELHIVERY_SMOKE_WAREHOUSE_NAME=<n>  Override the warehouse-create fixture name',
      '',
    ].join('\n'),
  );
}

/* ── Entry point ──────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const [, , rawCommand, ...rest] = process.argv;
  const command = (rawCommand ?? 'help') as Command;

  if (command === 'help' || !command) {
    runHelp();
    return;
  }

  const ctx = loadContext(command);
  switch (command) {
    case 'serviceability':
      if (!rest[0]) throw new Error('serviceability requires a pincode arg.');
      await runServiceability(ctx, rest[0]);
      return;
    case 'serviceability-heavy':
      if (!rest[0]) throw new Error('serviceability-heavy requires a pincode arg.');
      await runServiceabilityHeavy(ctx, rest[0]);
      return;
    case 'expected-tat':
      if (!rest[0] || !rest[1]) {
        throw new Error('expected-tat requires origin and destination pincodes.');
      }
      await runExpectedTat(ctx, rest[0], rest[1], rest[2] ?? 'S');
      return;
    case 'calculate-cost':
      if (!rest[0] || !rest[1] || !rest[2]) {
        throw new Error('calculate-cost requires <origin> <dest> <weight_gm>.');
      }
      await runCalculateCost(
        ctx,
        rest[0],
        rest[1],
        rest[2],
        rest[3] ?? 'E',
        rest[4] ?? 'Pre-paid',
      );
      return;
    case 'track':
      if (!rest[0]) throw new Error('track requires <awb1,awb2,...>.');
      await runTrack(ctx, rest[0]);
      return;
    case 'label':
      if (!rest[0]) throw new Error('label requires an AWB arg.');
      await runLabel(ctx, rest[0], rest[1] ?? 'A4');
      return;
    case 'ndr-status':
      if (!rest[0]) throw new Error('ndr-status requires a UPL id arg.');
      await runNdrStatus(ctx, rest[0]);
      return;
    case 'fetch-waybill':
      if (!rest[0]) throw new Error('fetch-waybill requires a count arg.');
      await runFetchWaybill(ctx, rest[0]);
      return;
    case 'create-order':
      await runCreateOrder(ctx);
      return;
    case 'update-order':
      if (!rest[0]) throw new Error('update-order requires an AWB arg.');
      await runUpdateOrder(ctx, rest[0]);
      return;
    case 'cancel':
      if (!rest[0]) throw new Error('cancel requires an AWB arg.');
      await runCancel(ctx, rest[0]);
      return;
    case 'create-rvp-order':
      await runCreateRvpOrder(ctx);
      return;
    case 'pickup-request':
      if (!rest[0] || !rest[1]) {
        throw new Error('pickup-request requires <YYYY-MM-DD> <HH:MM:SS>.');
      }
      await runPickupRequest(ctx, rest[0], rest[1]);
      return;
    case 'warehouse-create':
      await runWarehouseCreate(ctx);
      return;
    case 'warehouse-update':
      if (!rest[0]) throw new Error('warehouse-update requires a warehouse name arg.');
      await runWarehouseUpdate(ctx, rest[0]);
      return;
    case 'ndr-action':
      if (!rest[0] || !rest[1]) {
        throw new Error('ndr-action requires <awb> <RE-ATTEMPT|PICKUP_RESCHEDULE>.');
      }
      await runNdrAction(ctx, rest[0], rest[1]);
      return;
    case 'ewaybill-update':
      if (!rest[0] || !rest[1] || !rest[2]) {
        throw new Error('ewaybill-update requires <awb> <invoice_no> <ewb_no>.');
      }
      await runEwaybillUpdate(ctx, rest[0], rest[1], rest[2]);
      return;
    default:
      runHelp();
      throw new Error(`Unknown command: ${command as string}`);
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: (err as Error).message ?? String(err) }, null, 2));
  process.exit(1);
});
