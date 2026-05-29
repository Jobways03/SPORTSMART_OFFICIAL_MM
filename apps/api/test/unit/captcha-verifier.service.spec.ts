import 'reflect-metadata';
import { CaptchaVerifierService } from '../../src/integrations/captcha/captcha-verifier.service';

/**
 * Phase 16 (2026-05-20) — CaptchaVerifierService unit tests.
 *
 * Focuses on the policy boundaries (the actual HTTP call is mocked):
 *   1. CAPTCHA_PROVIDER=disabled → always passes silently (dev).
 *   2. provider=turnstile + missing token → throws CAPTCHA_REQUIRED.
 *   3. provider=turnstile + missing secret → fails closed.
 *   4. provider=turnstile + provider says { success: false } → fails closed.
 *   5. provider=turnstile + provider says { success: true } → passes.
 *   6. provider=turnstile + network error → fails closed.
 */

describe('CaptchaVerifierService', () => {
  const buildLogger = () => ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });

  const buildEnv = (provider: string, secret?: string) => ({
    getString: (key: string, fallback?: string) => {
      if (key === 'CAPTCHA_PROVIDER') return provider;
      return fallback ?? '';
    },
    getOptional: (key: string) => (key === 'CAPTCHA_SECRET' ? secret : undefined),
  });

  it('disabled mode → no token required, no fetch made', async () => {
    const logger = buildLogger();
    const env = buildEnv('disabled') as any;
    const svc = new CaptchaVerifierService(logger as any, env);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);
    await expect(svc.verify(undefined)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('turnstile + missing token → CAPTCHA_REQUIRED', async () => {
    const svc = new CaptchaVerifierService(buildLogger() as any, buildEnv('turnstile', 'sec') as any);
    await expect(svc.verify(undefined)).rejects.toThrow(/captcha/i);
    await expect(svc.verify('')).rejects.toThrow(/captcha/i);
  });

  it('turnstile + missing secret → fail closed', async () => {
    const svc = new CaptchaVerifierService(buildLogger() as any, buildEnv('turnstile', undefined) as any);
    await expect(svc.verify('any-token')).rejects.toThrow(/captcha/i);
  });

  it('turnstile + provider returns success=false → throws CAPTCHA_FAILED', async () => {
    const svc = new CaptchaVerifierService(buildLogger() as any, buildEnv('turnstile', 'sec') as any);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    } as any);
    await expect(svc.verify('bad-token')).rejects.toThrow(/captcha/i);
    fetchSpy.mockRestore();
  });

  it('turnstile + success → resolves', async () => {
    const svc = new CaptchaVerifierService(buildLogger() as any, buildEnv('turnstile', 'sec') as any);
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as any);
    await expect(svc.verify('good-token')).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });

  it('turnstile + network error → fail closed', async () => {
    const svc = new CaptchaVerifierService(buildLogger() as any, buildEnv('turnstile', 'sec') as any);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('econnreset'));
    await expect(svc.verify('any')).rejects.toThrow(/captcha/i);
    fetchSpy.mockRestore();
  });
});
