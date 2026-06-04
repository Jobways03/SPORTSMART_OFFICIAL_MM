/**
 * Cluster-D — email provider fake-success guard.
 *
 * When SMTP is unconfigured the underlying EmailService console-logs and
 * returns false. Reporting success:true/'dev-mail' in PRODUCTION silently
 * swallowed every customer email while the dashboard showed SENT. The
 * provider now HARD-FAILS in production when SMTP is unconfigured, while
 * keeping the dev-mail soft-success for non-production.
 */
import 'reflect-metadata';
import { EmailNotificationProvider } from './email.provider';

function makeEnv(opts: { production: boolean; configured: boolean }) {
  return {
    isProduction: () => opts.production,
    getString: (key: string, def = '') => {
      if (key === 'MAIL_USER') return opts.configured ? 'mailer@x.com' : def;
      if (key === 'MAIL_PASS') return opts.configured ? 'secret' : def;
      return def;
    },
  } as any;
}

function makeProvider(opts: {
  production: boolean;
  configured: boolean;
  serviceReturns?: boolean;
}) {
  const emailService = {
    send: jest.fn().mockResolvedValue(opts.serviceReturns ?? true),
  } as any;
  const provider = new EmailNotificationProvider(
    emailService,
    makeEnv({ production: opts.production, configured: opts.configured }),
  );
  return { provider, emailService };
}

const ARGS = { to: 'user@example.com', body: '<p>hi</p>' };

describe('EmailNotificationProvider (Cluster-D fake-success guard)', () => {
  it('PRODUCTION + unconfigured SMTP → hard fail (no fake dev-mail success)', async () => {
    const { provider, emailService } = makeProvider({ production: true, configured: false });
    const res = await provider.send(ARGS);
    expect(res.success).toBe(false);
    expect(res.retryable).toBe(false);
    expect(res.failureCode).toBe('NOT_CONFIGURED');
    // Must short-circuit before even attempting the (no-op) send.
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it('non-production + unconfigured SMTP → keeps dev-mail soft success', async () => {
    const { provider } = makeProvider({
      production: false,
      configured: false,
      serviceReturns: false, // EmailService returns false (console-logged)
    });
    const res = await provider.send(ARGS);
    expect(res.success).toBe(true);
    expect(res.providerMessageId).toBe('dev-mail');
  });

  it('configured SMTP + real send ok → smtp-ok success', async () => {
    const { provider } = makeProvider({
      production: true,
      configured: true,
      serviceReturns: true,
    });
    const res = await provider.send(ARGS);
    expect(res.success).toBe(true);
    expect(res.providerMessageId).toBe('smtp-ok');
  });

  it('configured SMTP but send returns false → retryable failure (not fake success)', async () => {
    const { provider } = makeProvider({
      production: true,
      configured: true,
      serviceReturns: false,
    });
    const res = await provider.send(ARGS);
    expect(res.success).toBe(false);
    expect(res.retryable).toBe(true);
  });

  it('invalid email address → non-retryable INVALID_EMAIL before any send', async () => {
    const { provider, emailService } = makeProvider({ production: true, configured: true });
    const res = await provider.send({ to: 'not-an-email', body: 'x' });
    expect(res.success).toBe(false);
    expect(res.retryable).toBe(false);
    expect(res.failureCode).toBe('INVALID_EMAIL');
    expect(emailService.send).not.toHaveBeenCalled();
  });
});
