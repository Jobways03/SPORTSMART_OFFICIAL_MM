import { z } from 'zod';

/**
 * Shadowfax-specific env binding. Lazy-parsed (provider in
 * `shadowfax.module.ts`) with the same dev/prod fallback as
 * Delhivery so the facade boots without sandbox credentials.
 *
 * Mirrors apps/api/src/integrations/ithink/config/ithink.config.ts.
 *
 * Production-safety: when this adapter goes production-live, add
 * `SHADOWFAX_API_TOKEN` + `SHADOWFAX_WEBHOOK_TOKEN` to
 * `EnvService.assertProductionSecretsSafe` with the `replace-me-`
 * placeholder pattern. The schema below already rejects placeholder
 * values in `production`.
 *
 * Field shape:
 *   • apiUrl / qrApiUrl  — partner-issued REST roots. Two hosts:
 *       Dale (orders, tracking, NDR, COD)
 *       Saruman (QR-code labels, manifests)
 *     Staging hosts are `*.staging.shadowfax.in/api`; production
 *     hosts are `*.shadowfax.in/api`. No trailing slash.
 *   • apiToken          — sent on every request as `Token <value>`.
 *   • clientCode        — Shadowfax-side merchant code.
 *   • webhookToken      — HMAC-style shared secret for webhook
 *                         verification (M1 webhook handler).
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

const baseShape = {
  apiUrl: z.string().url(),
  qrApiUrl: z.string().url(),
  apiToken: z.string().min(8),
  clientCode: z.string().min(1),
  webhookToken: z.string().min(8),
  requestTimeoutMs: z.coerce.number().int().positive().default(15_000),
  maxRetries: z.coerce.number().int().nonnegative().default(2),
} as const;

/**
 * Permissive schema used in dev/test/staging — placeholders accepted
 * so the facade boots without sandbox credentials.
 */
export const shadowfaxConfigSchema = z.object(baseShape);

/**
 * Strict schema used in production — placeholders are rejected so a
 * misconfigured deploy crashes on boot, not on first booking.
 */
export const shadowfaxConfigSchemaStrict = z.object({
  ...baseShape,
  apiUrl: baseShape.apiUrl,
  qrApiUrl: baseShape.qrApiUrl,
  apiToken: nonPlaceholder('SHADOWFAX_API_TOKEN'),
  clientCode: nonPlaceholder('SHADOWFAX_CLIENT_CODE'),
  webhookToken: nonPlaceholder('SHADOWFAX_WEBHOOK_TOKEN'),
});

export type ShadowfaxConfig = z.infer<typeof shadowfaxConfigSchema>;

/**
 * Parse the relevant slice of `process.env` into a typed config bag.
 * Called once, by the provider in `shadowfax.module.ts`.
 *
 * Behaviour by `NODE_ENV`:
 *   • production       — strict parse; missing/invalid/placeholder
 *                        values throw and abort boot.
 *   • everything else  — permissive parse with placeholder fallback
 *                        so the facade boots for local dev / smoke
 *                        tests that don't yet have sandbox creds.
 *                        Calling the partner with a placeholder still
 *                        fails at the HTTP layer (401 from Shadowfax).
 */
export function loadShadowfaxConfig(env: NodeJS.ProcessEnv): ShadowfaxConfig {
  const candidate = {
    apiUrl: env.SHADOWFAX_API_URL,
    qrApiUrl: env.SHADOWFAX_QR_API_URL,
    apiToken: env.SHADOWFAX_API_TOKEN,
    clientCode: env.SHADOWFAX_CLIENT_CODE,
    webhookToken: env.SHADOWFAX_WEBHOOK_TOKEN,
    requestTimeoutMs: env.SHADOWFAX_REQUEST_TIMEOUT_MS,
    maxRetries: env.SHADOWFAX_MAX_RETRIES,
  };

  if (env.NODE_ENV === 'production') {
    return shadowfaxConfigSchemaStrict.parse(candidate);
  }

  const parsed = shadowfaxConfigSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return shadowfaxConfigSchema.parse({
    apiUrl: candidate.apiUrl ?? 'https://dale.staging.shadowfax.in/api',
    qrApiUrl: candidate.qrApiUrl ?? 'https://saruman.staging.shadowfax.in/api',
    apiToken: candidate.apiToken ?? 'replace-me-shadowfax-api-token',
    clientCode: candidate.clientCode ?? 'replace-me-shadowfax-client-code',
    webhookToken: candidate.webhookToken ?? 'replace-me-shadowfax-webhook-token',
    requestTimeoutMs: candidate.requestTimeoutMs,
    maxRetries: candidate.maxRetries,
  });
}
