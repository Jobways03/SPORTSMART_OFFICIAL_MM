import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PrismaService');

  constructor() {
    super({
      datasourceUrl: process.env.DATABASE_URL,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connected');
    } catch (error) {
      this.logger.error(
        `Database connection failed: ${error instanceof Error ? error.message : error}`,
      );
      this.logger.warn('App will start but database operations will fail until connection is available');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
