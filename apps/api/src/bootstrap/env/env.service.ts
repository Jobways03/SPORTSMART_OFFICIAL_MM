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

  /**
   * Phase 4 (PR 4.6) — refuse to start in production with placeholder
   * JWT secrets from .env.example. Catches the foot-gun where an
   * operator copies the example to .env, fills in DB / Redis, and
   * forgets to rotate the JWT keys. A leaked placeholder lets anyone
   * forge any token (worse than a leaked real secret because the
   * "secret" is in source control).
   *
   * Throws — call before app.listen() so the process exits fast.
   */
  assertProductionSecretsSafe(): void {
    if (!this.isProduction()) return;

    const PLACEHOLDER_PREFIX = 'replace-me-';
    // Phase 21 (2026-05-20) — JWT_REFRESH_SECRET dropped from the
    // required list because refresh tokens are random UUIDs hashed at
    // rest, not JWTs — the secret was never consumed.
    //
    // Phase 25 (2026-05-20) — ADMIN_MFA_ENCRYPTION_KEY added. The
    // requiredInProd zod check enforces non-empty, but a value of
    // `replace-me-with-a-strong-random-string-min32-chars` from
    // .env.example satisfies non-empty while leaving every admin's
    // TOTP secret decryptable by anyone who reads the example file.
    // Same foot-gun, same defence.
    const REQUIRED_SECRETS: Array<keyof Env> = [
      'JWT_CUSTOMER_SECRET',
      'JWT_SELLER_SECRET',
      'JWT_FRANCHISE_SECRET',
      'JWT_ADMIN_SECRET',
      'JWT_AFFILIATE_SECRET',
      'ADMIN_MFA_ENCRYPTION_KEY',
    ];

    const offenders = REQUIRED_SECRETS.filter((k) => {
      const v = this.env[k];
      return typeof v === 'string' && v.startsWith(PLACEHOLDER_PREFIX);
    });

    if (offenders.length > 0) {
      throw new Error(
        `[BOOT] Refusing to start in production: the following secrets ` +
          `still hold the .env.example placeholder value: ${offenders.join(', ')}. ` +
          `Generate fresh values with \`openssl rand -base64 32\` and set them ` +
          `in the production environment.`,
      );
    }
  }
}
