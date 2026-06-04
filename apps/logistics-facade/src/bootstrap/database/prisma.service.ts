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
    try {
      await this.$connect();
      this.logger.log('Logistics database connected');
    } catch (error) {
      this.logger.error(
        `Logistics database connection failed: ${error instanceof Error ? error.message : error}`,
      );
      this.logger.warn(
        'App will start but DB operations will fail until the connection is available',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
