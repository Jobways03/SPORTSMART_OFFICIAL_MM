import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';

/**
 * Builds a fully-bootstrapped NestJS app from a caller-supplied
 * module and returns it plus teardown helpers. Mirrors the production
 * main.ts wiring (global prefix, URI versioning, ValidationPipe) so
 * e2e tests exercise the same request pipeline customers hit.
 *
 * Why not boot the real AppModule?
 *
 * AppModule starts every background service on `onModuleInit` —
 * franchise-reservation-cleanup, order-timeout, payment-poller, and
 * so on. Each registers a setInterval. Pulling those into a test
 * process keeps Jest alive after the test finishes and makes teardown
 * flaky. Compose a minimal module in the test with only the
 * controllers + providers the assertions need, and pass it here.
 *
 * Example:
 *   const app = await buildTestApp({ imports: [HealthOnlyModule] });
 *   await request(app.getHttpServer()).get('/api/v1/health/live');
 *   await app.close();
 */
export interface BuildTestAppOptions {
  imports?: any[];
  controllers?: any[];
  providers?: any[];
  /**
   * Apply `.overrideProvider(...).useValue(...)` pairs before the
   * module compiles. Use this to swap PrismaService / RedisService /
   * integration clients for fakes. The callback receives the
   * TestingModuleBuilder so you can chain multiple overrides.
   */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function buildTestApp(
  opts: BuildTestAppOptions,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: opts.imports ?? [],
    controllers: opts.controllers ?? [],
    providers: opts.providers ?? [],
  });

  if (opts.override) {
    builder = opts.override(builder);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });

  // Match production main.ts: global prefix, URI versioning with
  // default=1, and the same ValidationPipe options. Diverging here is
  // how e2e tests silently drift from reality.
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  return app;
}
