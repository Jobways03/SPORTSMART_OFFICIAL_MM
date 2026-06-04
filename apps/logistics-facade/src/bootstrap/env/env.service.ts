import { Injectable } from '@nestjs/common';
import { envSchema, Env } from './env.schema';

/**
 * Parsed-once, typed env accessor. Mirrors apps/api's EnvService —
 * keep the surface identical so future code can be lifted between
 * the two services without translation.
 */
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
    if (value === undefined || value === null || (value as unknown) === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing environment value: ${String(key)}`);
    }
    return Number(value);
  }

  getBoolean(key: keyof Env, fallback?: boolean): boolean {
    const value = this.env[key];
    if (value === undefined || value === null || (value as unknown) === '') {
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing environment value: ${String(key)}`);
    }
    return String(value) === 'true';
  }

  getOptional(key: keyof Env): string | undefined {
    const value = this.env[key];
    if (value === undefined || value === null || (value as unknown) === '') return undefined;
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

  /**
   * Refuse to boot in production with the .env.example placeholder
   * `INTERNAL_API_KEY`. Cheap safety net for the foot-gun where an
   * operator copies the example and forgets to rotate the key. The
   * full apps/api version checks 6+ JWT secrets; M0 has only one
   * shared secret so the check is correspondingly narrow.
   */
  assertProductionSecretsSafe(): void {
    if (!this.isProduction()) return;

    const PLACEHOLDER_PREFIX = 'replace-me-';
    const v = this.env.INTERNAL_API_KEY;
    if (typeof v === 'string' && v.startsWith(PLACEHOLDER_PREFIX)) {
      throw new Error(
        `[BOOT] Refusing to start in production: INTERNAL_API_KEY still ` +
          `holds the .env.example placeholder. Generate a value with ` +
          `\`openssl rand -hex 32\` and set it in the production environment.`,
      );
    }
  }
}
