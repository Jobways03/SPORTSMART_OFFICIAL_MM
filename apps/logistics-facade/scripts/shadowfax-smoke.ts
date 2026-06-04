/* eslint-disable no-console */
/**
 * Standalone smoke runner for the Shadowfax integration.
 *
 * Usage:
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax help
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax serviceability 560007
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax generate-awb 5
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax create-order
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax create-warehouse-order
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax track SF1234567890
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax track-bulk SF1,SF2,SF3
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax cancel SF1234567890 "Customer changed mind"
 *   pnpm --filter @sportsmart/logistics-facade smoke:shadowfax update SF1234567890
 *
 * Safety:
 *   • Refuses to run if `SHADOWFAX_API_URL` looks like production
 *     (`shadowfax.in/api` without `staging`).
 *   • Loads `.env` via `dotenv` so credentials live outside the repo.
 *   • Prints structured JSON suitable for piping into `jq`.
 *   • Exits 0 on success, non-zero on error.
 *
 * NOTE: keeps zero NestJS dependencies so it runs as plain tsx/ts-node
 * without bootstrapping the Nest container. We re-implement the
 * partner-call surface in-line (build URL, attach Token header) so the
 * smoke test exercises the wire protocol, not just the service code.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

type Command =
  | 'help'
  | 'serviceability'
  | 'generate-awb'
  | 'create-order'
  | 'create-warehouse-order'
  | 'track'
  | 'track-bulk'
  | 'cancel'
  | 'update';

interface SmokeContext {
  apiUrl: string;
  apiToken: string;
  clientCode: string;
  timeoutMs: number;
}

function loadContext(): SmokeContext {
  const apiUrl = process.env.SHADOWFAX_API_URL ?? '';
  const apiToken = process.env.SHADOWFAX_API_TOKEN ?? '';
  const clientCode = process.env.SHADOWFAX_CLIENT_CODE ?? '';
  const timeoutMs = Number(process.env.SHADOWFAX_REQUEST_TIMEOUT_MS ?? 15000);

  if (!apiUrl) {
    throw new Error('SHADOWFAX_API_URL is not set. Copy .env.example to .env and set it.');
  }
  if (!apiToken) {
    throw new Error('SHADOWFAX_API_TOKEN is not set. Ask the partner account manager for a sandbox token.');
  }
  // Production-safety: reject prod URL unless the operator opts in via
  // SHADOWFAX_ALLOW_PROD=1. The smoke script is for staging only.
  if (/shadowfax\.in\/api/.test(apiUrl) && !/staging/.test(apiUrl) && process.env.SHADOWFAX_ALLOW_PROD !== '1') {
    throw new Error(
      `Refusing to run against production URL (${apiUrl}). Set SHADOWFAX_API_URL to the staging host ` +
        `or set SHADOWFAX_ALLOW_PROD=1 to override (don't).`,
    );
  }
  return {
    apiUrl: apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl,
    apiToken,
    clientCode,
    timeoutMs,
  };
}

async function shadowfaxFetch(
  ctx: SmokeContext,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const url = `${ctx.apiUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const headers: Record<string, string> = {
      Authorization: `Token ${ctx.apiToken}`,
      Accept: 'application/json',
    };
    if (method === 'POST') headers['Content-Type'] = 'application/json';

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    let parsed: unknown = text;
    if (contentType.includes('application/json') && text.length > 0) {
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

/* ── Fixture builders ─────────────────────────────────────────────── */

interface FixtureOpts {
  mode: 'marketplace' | 'warehouse';
  locationType?: 'residential' | 'Commercial';
}

function buildCreateOrderBody(opts: FixtureOpts): Record<string, unknown> {
  const clientOrderId = `SMOKE-${Date.now()}-${randomUUID().slice(0, 8)}`;

  const order_details = {
    client_order_id: clientOrderId,
    actual_weight: 500,
    volumetric_weight: 0,
    product_value: 999,
    cod_amount: 0,
    payment_mode: 'Prepaid',
    total_amount: 999,
    order_service: 'regular',
  };

  const customer_details: Record<string, unknown> = {
    name: 'Smoke Customer',
    contact: '9999999999',
    address_line_1: '221B Baker Street',
    address_line_2: 'Apt 1',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: 110009,
  };
  if (opts.mode === 'warehouse' && opts.locationType) {
    customer_details.location_type = opts.locationType;
  }

  const addressBlock = {
    name: opts.mode === 'warehouse' ? 'Smoke Warehouse' : 'Smoke Pickup',
    contact: '9000000000',
    address_line_1: 'Plot 1, MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: 560007,
    unique_code: 'SMOKE-WH-01',
  };

  const returnKey = opts.mode === 'warehouse' ? 'rto_details' : 'rts_details';

  return {
    order_type: opts.mode,
    order_details,
    customer_details,
    pickup_details: addressBlock,
    [returnKey]: { ...addressBlock, name: 'Smoke Return' },
    product_details: [
      {
        sku_id: 'SKU-SMOKE-1',
        sku_name: 'Test SKU',
        hsn_code: '95069990',
        price: 999,
        additional_details: { quantity: 1 },
      },
    ],
    __clientOrderId: clientOrderId,
  };
}

/* ── Commands ─────────────────────────────────────────────────────── */

async function runServiceability(ctx: SmokeContext, pincode: string): Promise<void> {
  if (!/^\d{6}$/.test(pincode)) {
    throw new Error(`Invalid pincode "${pincode}" — must be 6 digits.`);
  }
  // Per Shadowfax docs: GET /v1/clients/serviceability/ with query params.
  // Valid `service` values: seller_pickup, customer_delivery,
  // customer_pickup, seller_delivery, warehouse_pickup, warehouse_return.
  const service = process.env.SHADOWFAX_SMOKE_SERVICE ?? 'customer_delivery';
  const qs = new URLSearchParams({
    service,
    pincodes: pincode,
    page: '1',
    count: '10',
  }).toString();
  const path = `/v1/clients/serviceability/?${qs}`;
  const { status, body } = await shadowfaxFetch(ctx, 'GET', path);
  printJson('serviceability', { status, request_service: service, request_pincode: pincode, body });
}

async function runGenerateAwb(ctx: SmokeContext, countArg: string): Promise<void> {
  const count = Number(countArg);
  if (!Number.isInteger(count) || count <= 0 || count > 100) {
    throw new Error(`Invalid count "${countArg}" — must be 1..100.`);
  }
  const { status, body } = await shadowfaxFetch(ctx, 'POST', '/v3/clients/orders/generate_awb/', {
    count,
  });
  printJson('generate-awb', { status, body });
}

async function runCreateOrder(
  ctx: SmokeContext,
  mode: 'marketplace' | 'warehouse',
): Promise<void> {
  const body = buildCreateOrderBody({
    mode,
    locationType: mode === 'warehouse' ? 'residential' : undefined,
  });
  const clientOrderId = body.__clientOrderId as string;
  delete (body as Record<string, unknown>).__clientOrderId;

  const { status, body: respBody } = await shadowfaxFetch(
    ctx,
    'POST',
    '/v3/clients/orders/',
    body,
  );
  // Surface AWB at the top level when present so the test runner can
  // pipe to `jq .awb`.
  const awb =
    typeof respBody === 'object' && respBody !== null && 'data' in respBody
      ? (respBody as { data?: { awb_number?: string } }).data?.awb_number
      : undefined;
  printJson(mode === 'warehouse' ? 'create-warehouse-order' : 'create-order', {
    request_client_order_id: clientOrderId,
    awb: awb ?? null,
    status,
    body: respBody,
  });
}

async function runTrack(ctx: SmokeContext, awb: string): Promise<void> {
  const path = `/v4/clients/orders/${encodeURIComponent(awb)}/track/`;
  const { status, body } = await shadowfaxFetch(ctx, 'GET', path);

  // Pretty-print the order summary + last 5 events if the response
  // shape matches the documented success envelope.
  let summary: Record<string, unknown> = {};
  let lastFive: unknown[] = [];
  if (
    typeof body === 'object' &&
    body !== null &&
    (body as { message?: string }).message === 'Success'
  ) {
    const success = body as {
      order_details?: {
        awb_number?: string;
        client_order_id?: string;
        status?: string;
        status_display?: string;
        customer_track_url?: string;
      };
      tracking_details?: Array<{ created?: string; status_id?: string; status?: string; location?: string; remarks?: string }>;
    };
    summary = {
      awb: success.order_details?.awb_number,
      client_order_id: success.order_details?.client_order_id,
      status_id: success.order_details?.status,
      status_display: success.order_details?.status_display,
      customer_track_url: success.order_details?.customer_track_url,
    };
    const events = success.tracking_details ?? [];
    lastFive = events.slice(-5);
  }

  printJson('track', {
    status,
    summary,
    last_5_events: lastFive,
    body,
  });
}

async function runTrackBulk(ctx: SmokeContext, awbsCsv: string): Promise<void> {
  const awbs = awbsCsv
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  if (awbs.length === 0) {
    throw new Error('track-bulk requires a comma-separated list of AWBs.');
  }
  if (awbs.length > 50) {
    throw new Error(`track-bulk supports max 50 AWBs per call (received ${awbs.length}).`);
  }

  const { status, body } = await shadowfaxFetch(
    ctx,
    'POST',
    '/v4/clients/bulk_track/',
    { awb_numbers: awbs },
  );

  let perAwb: Array<{ awb: string; status_id?: string; status_display?: string }> = [];
  if (
    typeof body === 'object' &&
    body !== null &&
    (body as { message?: string }).message === 'Success'
  ) {
    const success = body as {
      data?: Array<{
        awb_number?: string;
        status?: string;
        status_display?: string;
      }>;
    };
    perAwb = (success.data ?? []).map((entry) => ({
      awb: entry.awb_number ?? '',
      status_id: entry.status,
      status_display: entry.status_display,
    }));
  }

  printJson('track-bulk', {
    status,
    requested: awbs.length,
    summary: perAwb,
    body,
  });
}

async function runCancel(
  ctx: SmokeContext,
  awb: string,
  reason: string,
): Promise<void> {
  const { status, body } = await shadowfaxFetch(
    ctx,
    'POST',
    '/v3/clients/orders/cancel/',
    {
      request_id: awb,
      cancel_remarks: reason,
    },
  );

  // Surface the canonical outcome inline so the operator sees the
  // CANCELLED / CANCEL_QUEUED / ALREADY_CANCELLED decision at a glance.
  let canonical: string | null = null;
  if (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { responseCode?: number }).responseCode === 'number'
  ) {
    const { responseCode, responseMsg } = body as {
      responseCode: number;
      responseMsg: string;
    };
    const lower = (responseMsg ?? '').toLowerCase();
    if (responseCode === 200 && lower.includes('marked as cancelled')) {
      canonical = 'CANCELLED';
    } else if (responseCode === 304) {
      canonical = 'CANCEL_QUEUED';
    } else if (lower.includes('already in its cancellation phase')) {
      canonical = 'ALREADY_CANCELLED';
    } else {
      canonical = 'REJECTED';
    }
  }

  printJson('cancel', {
    status,
    canonical_outcome: canonical,
    body,
  });
}

async function runUpdate(ctx: SmokeContext, awb: string): Promise<void> {
  // Example: bump the customer's alternate contact. Useful for
  // verifying the endpoint accepts our auth + body shape without
  // mutating anything load-bearing.
  const body = {
    awb_numbers: awb,
    delivery_details: {
      alternate_contact: '9999000099',
    },
  };
  const { status, body: respBody } = await shadowfaxFetch(
    ctx,
    'POST',
    '/v3/clients/order_update/',
    body,
  );
  printJson('update', { status, request: body, body: respBody });
}

function runHelp(): void {
  console.log(
    [
      'Shadowfax smoke runner — usage:',
      '',
      '  serviceability <pincode>            Check pincode serviceability',
      '  generate-awb <count>                Generate <count> AWBs (1..100)',
      '  create-order                        Create a fixture marketplace order',
      '  create-warehouse-order              Create a fixture warehouse order',
      '                                       (location_type=residential)',
      '  track <awb>                         Single-AWB tracking; prints',
      '                                       order summary + last 5 events',
      '  track-bulk <awb1,awb2,...>          Bulk tracking (max 50/call)',
      '  cancel <awb> [reason]               Cancel an order. Default reason:',
      '                                       "Request cancelled by customer"',
      '  update <awb>                        Update an order (sets',
      '                                       alternate_contact=9999000099)',
      '  help                                This message',
      '',
      'Required env (set in .env at the facade root):',
      '  SHADOWFAX_API_URL                   Staging URL — refuses production',
      '  SHADOWFAX_API_TOKEN                 Token from the partner portal',
      '  SHADOWFAX_CLIENT_CODE               Merchant code (optional for smoke)',
      '  SHADOWFAX_REQUEST_TIMEOUT_MS        (optional, default 15000)',
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

  const ctx = loadContext();
  switch (command) {
    case 'serviceability':
      if (!rest[0]) throw new Error('serviceability requires a pincode arg.');
      await runServiceability(ctx, rest[0]);
      return;
    case 'generate-awb':
      if (!rest[0]) throw new Error('generate-awb requires a count arg.');
      await runGenerateAwb(ctx, rest[0]);
      return;
    case 'create-order':
      await runCreateOrder(ctx, 'marketplace');
      return;
    case 'create-warehouse-order':
      await runCreateOrder(ctx, 'warehouse');
      return;
    case 'track':
      if (!rest[0]) throw new Error('track requires an AWB arg.');
      await runTrack(ctx, rest[0]);
      return;
    case 'track-bulk':
      if (!rest[0]) throw new Error('track-bulk requires a comma-separated AWB list.');
      await runTrackBulk(ctx, rest[0]);
      return;
    case 'cancel':
      if (!rest[0]) throw new Error('cancel requires an AWB arg.');
      await runCancel(
        ctx,
        rest[0],
        rest.slice(1).join(' ').trim() || 'Request cancelled by customer',
      );
      return;
    case 'update':
      if (!rest[0]) throw new Error('update requires an AWB arg.');
      await runUpdate(ctx, rest[0]);
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
