import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvService } from '../env/env.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly envService: EnvService) {
    this.client = new Redis(this.envService.getString('REDIS_URL'));
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
