import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for two notification-layer hardenings:
 *
 * 1. WhatsAppClient: every outbound message goes through a shared
 *    `postMessage` helper with AbortSignal.timeout(30s). Previously
 *    each fetch was bare, so a hung Meta Graph connection could pin
 *    the event-bus worker dispatching the notification.
 *
 * 2. email-notification.handler: catch-block logger.error calls used
 *    `${err}` interpolation, which via JS toString emits the full
 *    Error including nodemailer-added detail (recipient address, SMTP
 *    server response, sometimes partial credentials). Narrowed to
 *    `${(err as Error)?.message ?? 'unknown error'}` so we keep the
 *    useful summary but drop the raw object dump into logs.
 */

describe('Notifications hardening', () => {
  const wa = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src/integrations/whatsapp/clients/whatsapp.client.ts',
    ),
    'utf8',
  );

  const email = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      'src/integrations/email/event-handlers/email-notification.handler.ts',
    ),
    'utf8',
  );

  it('WhatsApp client fetches carry AbortSignal.timeout', () => {
    const fetchCount = (wa.match(/\bfetch\s*\(/g) || []).length;
    const signalCount = (wa.match(/AbortSignal\.timeout/g) || []).length;
    expect(fetchCount).toBeGreaterThan(0);
    expect(signalCount).toBeGreaterThanOrEqual(fetchCount);
  });

  it('WhatsApp client routes messages through a shared postMessage helper', () => {
    // Both sendTextMessage and sendTemplateMessage should go through the
    // helper — so the duplication of fetch + error handling that used to
    // live in each method is gone.
    expect(wa).toMatch(/private\s+async\s+postMessage/);
    expect(wa).toMatch(/this\.postMessage\b/);
  });

  it('email notification handler does not interpolate raw err into logs', () => {
    // The old anti-pattern — `${err}` — calls Error.toString() which
    // includes nodemailer-added recipient + SMTP response detail.
    // Assert no remaining instances of the narrow regression pattern.
    //
    // `${err}` (unwrapped Error) at the end of a logger.error string.
    const leakyPattern = /logger\.error\([^)]*\$\{err\}\`\s*\)/g;
    const leaky = email.match(leakyPattern) || [];
    expect(leaky).toEqual([]);
  });

  it('email handler uses the narrowed-message pattern', () => {
    // Positive check — at least one catch block uses the new form.
    expect(email).toMatch(/\(err as Error\)\?\.message/);
  });
});
