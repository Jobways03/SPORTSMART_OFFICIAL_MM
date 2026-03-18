import { Injectable } from '@nestjs/common';
import { envSchema, Env } from './env.schema';

@Injectable()
export class EnvService {
  private readonly env: Env;

  constructor() {
    this.env = envSchema.parse(process.env);
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  getString(key: keyof Env, fallback?: string): string {
    const value = this.env[key];
    if (value === undefined || value === null || value === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing environment value: ${String(key)}`);
    }
    return String(value);
  }

  getNumber(key: keyof Env, fallback?: number): number {
    const value = this.env[key];
    if (value === undefined || value === null || value === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing environment value: ${String(key)}`);
    }
    return Number(value);
  }

  getBoolean(key: keyof Env, fallback?: boolean): boolean {
    const value = this.env[key];
    if (value === undefined || value === null || value === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing environment value: ${String(key)}`);
    }
    return String(value) === 'true';
  }

  getOptional(key: keyof Env): string | undefined {
    const value = this.env[key];
    if (value === undefined || value === null || value === '') return undefined;
    return String(value);
  }

  getCorsOrigins(): string[] {
    return this.getString('CORS_ORIGINS')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }
}
