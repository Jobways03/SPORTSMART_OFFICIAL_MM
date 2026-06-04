import { z } from 'zod';

/**
 * Delhivery-specific env binding. Lazy-parsed (provider in
 * `delhivery.module.ts`) with the same dev/prod fallback as
 * Shadowfax so the facade boots without sandbox credentials.
 *
 * Mirrors apps/logistics-facade/src/integrations/shadowfax/config/shadowfax.config.ts.
 *
 * Production-safety: when this adapter goes production-live, add
 * `DELHIVERY_API_TOKEN`, `DELHIVERY_CLIENT_NAME`, and
 * `DELHIVERY_WEBHOOK_TOKEN` to `EnvService.assertProductionSecretsSafe`
 * with the `replace-me-` placeholder pattern. The strict schema below
 * already rejects placeholder values AND non-production URLs in
 * `production` so a misconfigured deploy crashes on boot, not on the
 * first booking.
 *
 * Field shape:
 *   • apiUrl            — partner-issued REST root. Staging host is
 *                         `https://staging-express.delhivery.com`;
 *                         production host is `https://track.delhivery.com`.
 *                         No trailing slash.
 *                         VERIFY against one.delhivery.com docs.
 *   • apiToken          — sent on every request as `Token <value>`.
 *   • clientName        — Delhivery-side merchant/client code; required
 *                         in the create-shipment payload because a
 *                         single token can manage multiple clients.
 *   • webhookToken      — shared secret for webhook verification
 *                         (M1 webhook handler).
 *   • requestTimeoutMs  — per-request HTTP timeout, default 15s.
 *   • maxRetries        — retry budget for 5xx/network errors,
 *                         default 2 (so total attempts <= 3).
 */
const PLACEHOLDER_PREFIX = 'replace-me-';

const nonPlaceholder = (label: string) =>
  z.string().min(1).refine((v) => !v.startsWith(PLACEHOLDER_PREFIX), {
    message:
      `${label} still holds an .env.example placeholder. Set a real value in production.`,
  });

/**
 * Production URLs must NOT contain "staging" — we point at
 * track.delhivery.com (or whatever the prod host turns out to be on
 * the "one" portal). VERIFY against the current Delhivery docs.
 */
const productionUrl = z
  .string()
  .url()
  .refine((v) => !/staging/i.test(v), {
    message:
      'DELHIVERY_API_URL appears to point at staging in production. Use the prod host.',
  });

const baseShape = {
  apiUrl: z.string().url(),
  apiToken: z.string().min(8),
  clientName: z.string().min(1),
  webhookToken: z.string().min(8),
  requestTimeoutMs: z.coerce.number().int().positive().default(15_000),
  maxRetries: z.coerce.number().int().nonnegative().default(2),
  /**
   * Default warehouse name used for `pickup_location.name` in
   * create-shipment requests when the canonical payload doesn't
   * carry a Seller.warehouseCode.
   *
   * MUST exactly match a warehouse registered in the Delhivery One
   * panel (case + space sensitive) — typos surface as
   * "ClientWarehouseMatchingQueryDoesNotExist".
   *
   * TODO: eventually source per-shipment via a Seller.warehouseCode
   * lookup on the canonical request; the config default is the M1
   * fallback for the single-warehouse rollout.
   */
  defaultPickupWarehouseName: z.string().optional(),
} as const;

/**
 * Permissive schema used in dev/test/staging — placeholders accepted
 * so the facade boots without sandbox credentials.
 */
export const delhiveryConfigSchema = z.object(baseShape);

/**
 * Strict schema used in production — placeholders are rejected and
 * `apiUrl` must not look like the staging host.
 */
export const delhiveryConfigSchemaStrict = z.object({
  ...baseShape,
  apiUrl: productionUrl,
  apiToken: nonPlaceholder('DELHIVERY_API_TOKEN'),
  clientName: nonPlaceholder('DELHIVERY_CLIENT_NAME'),
  webhookToken: nonPlaceholder('DELHIVERY_WEBHOOK_TOKEN'),
});

export type DelhiveryConfig = z.infer<typeof delhiveryConfigSchema>;

/**
 * Parse the relevant slice of `process.env` into a typed config bag.
 * Called once, by the provider in `delhivery.module.ts`.
 *
 * Behaviour by `NODE_ENV`:
 *   • production       — strict parse; missing/invalid/placeholder
 *                        values throw and abort boot.
 *   • everything else  — permissive parse with placeholder fallback
 *                        so the facade boots for local dev / smoke
 *                        tests that don't yet have sandbox creds.
 *                        Calling the partner with a placeholder still
 *                        fails at the HTTP layer (401 from Delhivery).
 */
export function loadDelhiveryConfig(env: NodeJS.ProcessEnv): DelhiveryConfig {
  const candidate = {
    apiUrl: env.DELHIVERY_API_URL,
    apiToken: env.DELHIVERY_API_TOKEN,
    clientName: env.DELHIVERY_CLIENT_NAME,
    webhookToken: env.DELHIVERY_WEBHOOK_TOKEN,
    requestTimeoutMs: env.DELHIVERY_REQUEST_TIMEOUT_MS,
    maxRetries: env.DELHIVERY_MAX_RETRIES,
    defaultPickupWarehouseName: env.DELHIVERY_PICKUP_WAREHOUSE_NAME,
  };

  if (env.NODE_ENV === 'production') {
    return delhiveryConfigSchemaStrict.parse(candidate);
  }

  const parsed = delhiveryConfigSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return delhiveryConfigSchema.parse({
    apiUrl: candidate.apiUrl ?? 'https://staging-express.delhivery.com',
    apiToken: candidate.apiToken ?? 'replace-me-delhivery-api-token',
    clientName: candidate.clientName ?? 'replace-me-delhivery-client',
    webhookToken: candidate.webhookToken ?? 'replace-me-delhivery-webhook-token',
    requestTimeoutMs: candidate.requestTimeoutMs,
    maxRetries: candidate.maxRetries,
    defaultPickupWarehouseName: candidate.defaultPickupWarehouseName,
  });
}
