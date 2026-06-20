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
 * `apiUrl`/`apiKey` are OPTIONAL: the module factory parses this eagerly
 * at DI bootstrap, so requiring them would crash-loop apps/api anywhere
 * the facade isn't deployed (e.g. AWS staging, where it has no service) —
 * the env-schema already treats both as optional. When unset the
 * integration is simply disabled; the client throws a clear error if a
 * caller actually makes a request (see LogisticsFacadeClient). When they
 * ARE provided, the url()/min(8) checks still fail fast on a bad value.
 */
const ConfigSchema = z.object({
  apiUrl: z.string().url().optional(),
  apiKey: z.string().min(8).optional(),
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
