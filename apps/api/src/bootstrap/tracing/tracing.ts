/**
 * Phase 11 (2026-05-16) — OpenTelemetry bootstrap.
 *
 * This file MUST be imported at the very top of `main.ts`, before
 * anything else, so the SDK can patch the Node module loader before
 * the Express / Prisma / Redis modules are first loaded by the
 * application. The SDK can't auto-instrument modules that are
 * already in the require cache.
 *
 * # Why lazy-require?
 *
 * The OpenTelemetry packages add ~30MB to the install footprint and
 * a small startup cost (the SDK proto-patches dozens of native
 * functions). Most local dev work doesn't need distributed tracing,
 * and CI runs spin up + tear down ~250 test suites per build. The
 * lazy-require keeps that overhead out of the default path:
 *
 *   • If `OTEL_ENABLED=false` (the default), this file is a no-op.
 *     The SDK packages are never loaded. The Node process starts
 *     exactly as it did pre-Phase-11.
 *   • If `OTEL_ENABLED=true` AND the OTel packages are installed,
 *     the SDK initializes with auto-instrumentations for HTTP,
 *     Express, Nest, Prisma, ioredis, pg, http, dns, and net.
 *   • If `OTEL_ENABLED=true` but the packages are NOT installed,
 *     we log a clear warning to stderr and continue without
 *     tracing. This lets ops flip the flag in staging to check
 *     wiring before running `pnpm add @opentelemetry/...`.
 *
 * # Packages required when enabling
 *
 *   pnpm add --filter @sportsmart/api \
 *     @opentelemetry/api \
 *     @opentelemetry/sdk-node \
 *     @opentelemetry/auto-instrumentations-node \
 *     @opentelemetry/exporter-trace-otlp-http \
 *     @opentelemetry/resources \
 *     @opentelemetry/semantic-conventions
 *
 * # Env knobs
 *
 *   OTEL_ENABLED                — "true" to start the SDK.
 *   OTEL_SERVICE_NAME           — defaults to "sportsmart-api".
 *   OTEL_EXPORTER_OTLP_ENDPOINT — defaults to "http://localhost:4318".
 *                                 Standard OTLP/HTTP collector port.
 *   OTEL_TRACES_SAMPLER_RATIO   — 0.0–1.0, defaults to 0.1 (10%).
 */

export function initTracing(): void {
  if ((process.env.OTEL_ENABLED || 'false').toLowerCase() !== 'true') {
    return;
  }

  let sdkModule: any;
  let autoInstr: any;
  let otlpExporter: any;
  let resourcesModule: any;
  let semconv: any;

  try {
    // Use `eval('require')` to keep the OpenTelemetry packages out
    // of the static dependency graph. TypeScript's compile-time
    // checking won't try to resolve them, and `pnpm install` won't
    // complain when they're absent. When `OTEL_ENABLED=true` but
    // the packages aren't installed, these requires throw and the
    // catch below logs + returns.
    /* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-eval */
    const nodeRequire: (id: string) => any = (0, eval)('require');
    sdkModule = nodeRequire('@opentelemetry/sdk-node');
    autoInstr = nodeRequire('@opentelemetry/auto-instrumentations-node');
    otlpExporter = nodeRequire('@opentelemetry/exporter-trace-otlp-http');
    resourcesModule = nodeRequire('@opentelemetry/resources');
    semconv = nodeRequire('@opentelemetry/semantic-conventions');
    /* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-eval */
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[tracing] OTEL_ENABLED=true but OpenTelemetry packages are not installed. ` +
        `Continuing without tracing. Install instructions in apps/api/src/bootstrap/tracing/tracing.ts. ` +
        `Original error: ${(err as Error).message}`,
    );
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME || 'sportsmart-api';
  const otlpEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://localhost:4318/v1/traces';
  const samplerRatio = Number(process.env.OTEL_TRACES_SAMPLER_RATIO ?? '0.1');

  const traceExporter = new otlpExporter.OTLPTraceExporter({
    url: otlpEndpoint,
  });

  const sdk = new sdkModule.NodeSDK({
    resource: new resourcesModule.Resource({
      [semconv.SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [semconv.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
        process.env.NODE_ENV || 'development',
    }),
    traceExporter,
    sampler: new sdkModule.tracing.ParentBasedSampler({
      root: new sdkModule.tracing.TraceIdRatioBasedSampler(
        Number.isFinite(samplerRatio) ? samplerRatio : 0.1,
      ),
    }),
    instrumentations: [
      autoInstr.getNodeAutoInstrumentations({
        // Suppress noisy fs spans; bring them back per-investigation
        // by flipping `enabled: true` in env-driven overrides.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // The Pino/Winston/Bunyan instrumentations add log correlation
        // fields (`trace_id`, `span_id`) automatically when active.
        // We pass an empty config so the defaults apply.
      }),
    ],
  });

  try {
    sdk.start();
    // eslint-disable-next-line no-console
    console.log(
      `[tracing] OpenTelemetry started — service=${serviceName} ` +
        `endpoint=${otlpEndpoint} samplerRatio=${samplerRatio}`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[tracing] OpenTelemetry SDK failed to start: ${(err as Error).message}. ` +
        `Continuing without tracing.`,
    );
    return;
  }

  // Graceful shutdown — flush pending spans on SIGTERM/SIGINT so the
  // last few seconds of activity don't get dropped. Nest's
  // enableShutdownHooks fires after SIGTERM; our signal handler in
  // main.ts then calls app.close(); we plug into the same lifecycle
  // by registering our own listeners with a higher priority.
  const shutdown = async () => {
    try {
      await sdk.shutdown();
    } catch {
      // Best-effort; the process is going down anyway.
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
