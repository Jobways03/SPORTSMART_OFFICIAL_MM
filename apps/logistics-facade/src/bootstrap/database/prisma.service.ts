import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * NestJS-managed Prisma client. Same shape as apps/api's PrismaService:
 * lazy $connect on init, $disconnect on shutdown, swallow startup
 * connect failures so the app still boots (LB probes will see
 * /readiness fail and refuse to route traffic until the DB is up).
 *
 * NOTE: reads LOGISTICS_DATABASE_URL — not the shared DATABASE_URL.
 * The facade owns its own database (see prisma.config.ts).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('LogisticsPrismaService');

  constructor() {
    super({
      datasourceUrl: process.env.LOGISTICS_DATABASE_URL,
    });
  }

  async onModuleInit(): Promise<void> {
    // Bounded connect-retry with exponential backoff. The facade owns a SEPARATE
    // Supabase project from the main API; on a free tier it auto-pauses when idle
    // and takes a few seconds to resume on the first connection. A single eager
    // $connect() raced that resume and logged a scary "Can't reach database"
    // error at boot. Retrying briefly lets the project wake and warms the
    // connection before requests arrive. If it still can't connect we boot
    // anyway (Prisma reconnects lazily on the first query) — preserving the
    // original "start degraded, readiness stays down" behaviour.
    const maxAttempts = Math.max(
      1,
      Number(process.env.LOGISTICS_DB_CONNECT_ATTEMPTS ?? 5),
    );
    const baseDelayMs = Math.max(
      100,
      Number(process.env.LOGISTICS_DB_CONNECT_BASE_DELAY_MS ?? 1000),
    );
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log(
          attempt === 1
            ? 'Logistics database connected'
            : `Logistics database connected (attempt ${attempt}/${maxAttempts})`,
        );
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts) {
          const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 10_000);
          this.logger.warn(
            `Logistics database connect attempt ${attempt}/${maxAttempts} failed ` +
              `(${msg.split('\n')[0]}); retrying in ${delay}ms ` +
              '(a paused Supabase project resumes in a few seconds).',
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          this.logger.error(
            `Logistics database connection failed after ${maxAttempts} attempts: ${msg}`,
          );
          this.logger.warn(
            'App will start but DB operations will fail until the connection is available',
          );
        }
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
