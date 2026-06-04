/**
 * OpenTelemetry bootstrap. Mirrors apps/api/src/bootstrap/tracing/tracing.ts
 * so a shared collector dashboard can correlate spans across both
 * services.
 *
 * MUST be the very first import in main.ts — the SDK patches the
 * Node module loader and any module loaded before it is invisible
 * to auto-instrumentation.
 *
 * Lazy-require strategy: the OTel packages add ~30 MB and a
 * non-trivial startup cost. When `OTEL_ENABLED!=true` this file is
 * a hard no-op and the packages never resolve, so local dev and CI
 * stay snappy. M0 ships with the file in place but the packages
 * uninstalled — flip the env flag once they're added to package.json.
 */
export function initTracing(): void {
  if ((process.env.OTEL_ENABLED || 'false').toLowerCase() !== 'true') {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdkModule = eval('require')('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const autoInstr = eval('require')('@opentelemetry/auto-instrumentations-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const otlpExporter = eval('require')('@opentelemetry/exporter-trace-otlp-http');

    const sdk = new sdkModule.NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME || 'sportsmart-logistics-facade',
      traceExporter: new otlpExporter.OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
      }),
      instrumentations: [autoInstr.getNodeAutoInstrumentations()],
    });

    sdk.start();
    // eslint-disable-next-line no-console
    console.log('[tracing] OpenTelemetry SDK started');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[tracing] OTEL_ENABLED=true but packages not installed — running without tracing. Install: pnpm add @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http. Error: ${(err as Error).message}`,
    );
  }
}
