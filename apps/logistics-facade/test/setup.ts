/**
 * Jest pre-test setup. Runs before every e2e suite.
 *
 * Establishes a sane env so:
 *   • EnvService.parse doesn't crash on boot (every required var has a value).
 *   • The INTERNAL_API_KEY in the test suite matches what the
 *     smoke test passes in the Authorization header.
 *
 * We deliberately do NOT point at a real DB / Redis — the smoke test
 * skips the readiness route and the controllers throw 501 before any
 * repository call.
 */
process.env.NODE_ENV = 'test';
process.env.LOGISTICS_FACADE_PORT = '0'; // ephemeral port for Nest test app
process.env.LOGISTICS_DATABASE_URL =
  process.env.LOGISTICS_DATABASE_URL || 'postgresql://test:test@localhost:5432/test?schema=public';
process.env.LOGISTICS_REDIS_URL =
  process.env.LOGISTICS_REDIS_URL || 'redis://localhost:6379/15';
process.env.INTERNAL_API_KEY =
  'test-internal-api-key-padded-to-32-chars-min';
process.env.CORS_ORIGINS = 'http://localhost:8000';
process.env.LOG_LEVEL = 'error';
