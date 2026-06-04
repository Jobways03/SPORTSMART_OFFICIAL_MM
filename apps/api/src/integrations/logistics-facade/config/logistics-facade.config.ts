import { z } from 'zod';

/**
 * Env-validated config slice for the logistics-facade HTTP client.
 *
 *   • `apiUrl`  — the base URL of the logistics-facade service. In
 *                 dev/local this is typically http://localhost:8001 (or
 *                 wherever the facade boots). In prod, the internal
 *                 load-balancer URL.
 *   • `apiKey`  — shared secret rotated by ops. Sent as
 *                 `Authorization: ApiKey <key>` on every request,
 *                 matching the facade's `ApiKeyAuthGuard` expectation.
 *
 * Lazy parsing (called from the module factory) so apps/api boots
 * cleanly in environments where the facade integration is feature-
 * flagged off — see `LOGISTICS_PARTNER_REGISTRATION_ENABLED`.
 */
const ConfigSchema = z.object({
  apiUrl: z.string().url(),
  apiKey: z.string().min(8),
  /** Per-request timeout in milliseconds. */
  timeoutMs: z.number().int().positive().default(30_000),
});

export type LogisticsFacadeConfig = z.infer<typeof ConfigSchema>;

export function loadLogisticsFacadeConfig(
  env: NodeJS.ProcessEnv,
): LogisticsFacadeConfig {
  return ConfigSchema.parse({
    apiUrl: env.LOGISTICS_FACADE_URL,
    apiKey: env.LOGISTICS_FACADE_API_KEY,
    timeoutMs: env.LOGISTICS_FACADE_TIMEOUT_MS
      ? Number(env.LOGISTICS_FACADE_TIMEOUT_MS)
      : undefined,
  });
}
