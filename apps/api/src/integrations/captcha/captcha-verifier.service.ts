import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../bootstrap/env/env.service';
import { BadRequestAppException } from '../../core/exceptions';

/**
 * Phase 16 (2026-05-20) — Bot-protection for unauthenticated auth
 * endpoints (register, verify-email-otp, resend-email-otp).
 *
 * Supported providers, picked by CAPTCHA_PROVIDER:
 *
 *   • `turnstile`  — Cloudflare Turnstile. The widget on the frontend
 *                    issues a token; we verify by POST to
 *                    `https://challenges.cloudflare.com/turnstile/v0/siteverify`
 *                    with `secret` + `response`. Returns `{ success: bool }`.
 *   • `hcaptcha`   — hCaptcha. Same shape, different endpoint
 *                    (`https://hcaptcha.com/siteverify`).
 *   • `disabled`   — local dev / test. The verify call always returns
 *                    true. Logs a one-line WARN on first call so the
 *                    deploy is loud about the open door.
 *
 * The provider key is read once at construction; switching providers
 * is a config + redeploy (not a hot-reload). Verification has a 5s
 * timeout — slow captcha provider should fail closed, not stall the
 * register response.
 *
 * The verifier never throws on programmer / network error during
 * the fetch — it converts those to a uniform "captcha failed" 400.
 * That keeps the error surface narrow (clients see one CAPTCHA_FAILED
 * code regardless of upstream failure mode).
 */
@Injectable()
export class CaptchaVerifierService {
  private readonly provider: 'turnstile' | 'hcaptcha' | 'disabled';
  private readonly secret: string | undefined;
  private warnedDisabled = false;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly env: EnvService,
  ) {
    this.logger.setContext('CaptchaVerifierService');
    const raw = this.env.getString('CAPTCHA_PROVIDER', 'disabled').toLowerCase();
    if (raw === 'turnstile' || raw === 'hcaptcha' || raw === 'disabled') {
      this.provider = raw;
    } else {
      this.logger.warn(
        `Unknown CAPTCHA_PROVIDER '${raw}' — falling back to 'disabled'. Set CAPTCHA_PROVIDER=turnstile or hcaptcha in production.`,
      );
      this.provider = 'disabled';
    }
    this.secret = this.env.getOptional('CAPTCHA_SECRET');
  }

  /**
   * Verify a captcha token. Returns silently on success; throws
   * BadRequestAppException('CAPTCHA_FAILED') on missing/invalid token.
   *
   * @param token       The token issued by the captcha widget.
   * @param remoteIp    Optional client IP — improves Turnstile + hCaptcha
   *                    scoring. Both providers ignore unknown fields, so
   *                    passing this is safe even when not used.
   */
  async verify(token: string | undefined, remoteIp?: string): Promise<void> {
    if (this.provider === 'disabled') {
      if (!this.warnedDisabled) {
        this.logger.warn(
          'CAPTCHA_PROVIDER=disabled — all captcha tokens accepted. Do not run this in production.',
        );
        this.warnedDisabled = true;
      }
      return;
    }

    if (!token || token.trim().length === 0) {
      throw new BadRequestAppException(
        'Captcha verification required',
        'CAPTCHA_REQUIRED',
      );
    }

    if (!this.secret) {
      // Misconfigured production: provider is set but no secret.
      // Fail closed rather than accept-by-default, but emit a loud
      // log line so the on-call notices instead of staring at a
      // generic 400.
      this.logger.error(
        `CAPTCHA_PROVIDER=${this.provider} but CAPTCHA_SECRET is unset — refusing all captcha tokens. Set CAPTCHA_SECRET in env.`,
      );
      throw new BadRequestAppException(
        'Captcha verification temporarily unavailable',
        'CAPTCHA_MISCONFIGURED',
      );
    }

    const verifyUrl =
      this.provider === 'turnstile'
        ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
        : 'https://hcaptcha.com/siteverify';

    const params = new URLSearchParams();
    params.set('secret', this.secret);
    params.set('response', token);
    if (remoteIp) params.set('remoteip', remoteIp);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `Captcha provider returned HTTP ${res.status} — refusing token.`,
        );
        throw new BadRequestAppException(
          'Captcha verification failed',
          'CAPTCHA_FAILED',
        );
      }
      const json = (await res.json()) as {
        success?: boolean;
        'error-codes'?: string[];
      };
      if (!json.success) {
        this.logger.warn(
          `Captcha verify failed: ${(json['error-codes'] ?? []).join(',')}`,
        );
        throw new BadRequestAppException(
          'Captcha verification failed',
          'CAPTCHA_FAILED',
        );
      }
    } catch (err) {
      if (err instanceof BadRequestAppException) throw err;
      // Network failure, parse error, timeout — fail closed.
      this.logger.warn(
        `Captcha verify network error: ${(err as Error)?.message ?? 'unknown'}`,
      );
      throw new BadRequestAppException(
        'Captcha verification failed',
        'CAPTCHA_FAILED',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
