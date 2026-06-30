import { EmailService } from './email.service';

/**
 * Phase 1 (PR 1.6) — SMTP transport timeouts.
 *
 * Pins the contract that `EmailService.transporter` is created with
 * explicit `connectionTimeout` / `greetingTimeout` / `socketTimeout`.
 * Without these, nodemailer defaults to 10 minutes on every step and
 * a single hung SMTP server pins every event-handler thread that
 * awaits `EmailService.send` for up to half an hour.
 *
 * We intercept nodemailer's `createTransport` via a jest mock and
 * assert the call shape — going further (actual SMTP server simulation)
 * would belong in an integration test.
 */

const createTransportMock = jest.fn();
const sendMailMock = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: (opts: unknown) => {
    createTransportMock(opts);
    return {
      verify: jest.fn().mockResolvedValue(true),
      sendMail: (args: unknown) => sendMailMock(args),
    };
  },
}));

function buildEnv(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    MAIL_USER: 'noreply@example.com',
    MAIL_PASS: 'app-password-here',
    MAIL_HOST: 'smtp.example.com',
    MAIL_PORT: '587',
    MAIL_SECURE: 'false',
    MAIL_FROM: 'SPORTSMART <noreply@example.com>',
  };
  const merged = { ...defaults, ...overrides };
  return {
    getString: jest.fn((key: string, fallback?: string) => {
      const v = merged[key];
      if (v !== undefined && v !== '') return v;
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing ${key}`);
    }),
    getNumber: jest.fn((key: string, fallback?: number) => {
      const v = merged[key];
      if (v !== undefined) return Number(v);
      if (fallback !== undefined) return fallback;
      throw new Error(`Missing ${key}`);
    }),
  } as any;
}

const noopLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

describe('EmailService — SMTP timeouts (PR 1.6)', () => {
  beforeEach(() => {
    createTransportMock.mockClear();
  });

  it('creates the transport with all three explicit timeouts', () => {
    new EmailService(buildEnv(), noopLogger);

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      }),
    );
  });

  it('enables connection pooling for burst protection', () => {
    new EmailService(buildEnv(), noopLogger);
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ pool: true, maxConnections: 5 }),
    );
  });

  it('preserves the existing host/port/auth config', () => {
    new EmailService(
      buildEnv({
        MAIL_HOST: 'smtp.custom.io',
        MAIL_PORT: '465',
        MAIL_SECURE: 'true',
      }),
      noopLogger,
    );
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.custom.io',
        port: 465,
        secure: true,
        auth: { user: 'noreply@example.com', pass: 'app-password-here' },
      }),
    );
  });

  it('does NOT instantiate a transport when MAIL_USER is unset (dev mode)', () => {
    new EmailService(buildEnv({ MAIL_USER: '' }), noopLogger);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('does NOT instantiate a transport when MAIL_PASS is unset', () => {
    new EmailService(buildEnv({ MAIL_PASS: '' }), noopLogger);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  // ── Regression guards ─────────────────────────────────────────────

  it('timeouts are bounded — connection/greeting ≤ 30s, socket ≤ 60s', () => {
    // Catches a future refactor that accidentally inflates the
    // timeouts back to nodemailer defaults (which is what PR 1.6
    // existed to prevent).
    new EmailService(buildEnv(), noopLogger);
    const opts = createTransportMock.mock.calls[0][0] as {
      connectionTimeout: number;
      greetingTimeout: number;
      socketTimeout: number;
    };
    expect(opts.connectionTimeout).toBeLessThanOrEqual(30_000);
    expect(opts.greetingTimeout).toBeLessThanOrEqual(30_000);
    expect(opts.socketTimeout).toBeLessThanOrEqual(60_000);
  });
});

/**
 * 2026-06-30 — Transient-failure retry on send().
 *
 * Regression cover for the production bug where the first verification
 * OTP email was never delivered (only a manual "Resend" worked). At
 * registration the welcome email + OTP email race on a cold,
 * connection-capped shared-hosting SMTP pool; the first send threw a
 * transient SMTP error (cold-handshake timeout / 421 too-many-
 * connections) and EmailService silently returned false. send() now
 * retries a transient failure once, mirroring the manual resend.
 *
 * These tests FAIL on the pre-fix code (single attempt, no retry).
 */
describe('EmailService — transient-failure retry on send()', () => {
  const opts = {
    to: 'partner@example.com',
    subject: 'Your SPORTSMART Verification Code',
    html: '<p>Your code is 123456</p>',
  };

  beforeEach(() => {
    createTransportMock.mockClear();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue({ messageId: 'msg-1' });
  });

  function buildService() {
    const svc = new EmailService(buildEnv(), noopLogger);
    // Skip the real backoff sleep so the suite stays fast.
    jest.spyOn(svc as any, 'sleep').mockResolvedValue(undefined);
    return svc;
  }

  it('sends on the first attempt when SMTP is healthy (no retry)', async () => {
    const svc = buildService();
    await expect(svc.send(opts)).resolves.toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and succeeds on the next attempt', async () => {
    const svc = buildService();
    const transientErr = Object.assign(new Error('Greeting never received'), {
      code: 'EGREETING',
    });
    sendMailMock
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce({ messageId: 'msg-2' });

    await expect(svc.send(opts)).resolves.toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 421 "too many connections" (the registration race)', async () => {
    const svc = buildService();
    const err421 = Object.assign(new Error('421 Too many concurrent connections'), {
      responseCode: 421,
    });
    sendMailMock
      .mockRejectedValueOnce(err421)
      .mockResolvedValueOnce({ messageId: 'msg-3' });

    await expect(svc.send(opts)).resolves.toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a permanent failure (auth / 5xx) — fails fast', async () => {
    const svc = buildService();
    const sleepSpy = jest.spyOn(svc as any, 'sleep');
    const permErr = Object.assign(new Error('Invalid login: 535 auth failed'), {
      code: 'EAUTH',
      responseCode: 535,
    });
    sendMailMock.mockRejectedValue(permErr);

    await expect(svc.send(opts)).resolves.toBe(false);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  it('gives up and returns false after the bounded max attempts', async () => {
    const svc = buildService();
    const transientErr = Object.assign(new Error('Connection timeout'), {
      code: 'ETIMEDOUT',
    });
    sendMailMock.mockRejectedValue(transientErr);

    await expect(svc.send(opts)).resolves.toBe(false);
    // MAX_SEND_ATTEMPTS = 2 → original + one retry, then give up.
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });
});
