import 'reflect-metadata';
import { resolveLocale } from '../../src/core/i18n/locale-resolver';
import {
  MessageCatalogueService,
  substitute,
} from '../../src/core/i18n/message-catalogue.service';

/**
 * Phase 9 (PR 9.2) — i18n resolver + catalogue.
 *
 * Two trust boundaries: locale resolution (a wrong fallback chain
 * means a Hindi user sees English, or worse, the literal key) and
 * placeholder substitution (silent removal of `{{name}}` would hide
 * dev bugs).
 */

describe('resolveLocale', () => {
  it('explicit override beats everything', () => {
    const r = resolveLocale({
      override: 'hi',
      userPreferred: 'en',
      acceptLanguage: 'en;q=1.0',
    });
    expect(r.locale).toBe('hi');
  });

  it('user-preferred wins over Accept-Language', () => {
    const r = resolveLocale({
      userPreferred: 'hi-IN',
      acceptLanguage: 'en;q=1.0',
    });
    expect(r.locale).toBe('hi-IN');
    expect(r.fallbackChain).toEqual(['hi-IN', 'hi', 'en']);
  });

  it('Accept-Language q-weighted parse picks the highest-weight match', () => {
    const r = resolveLocale({
      acceptLanguage: 'fr;q=0.5, hi;q=0.9, en;q=0.4',
    });
    expect(r.locale).toBe('hi');
  });

  it('falls back to base language when region not in supported set', () => {
    const r = resolveLocale({ override: 'hi-XX' });
    expect(r.locale).toBe('hi');
  });

  it('falls back to default when nothing matches', () => {
    const r = resolveLocale({ override: 'jp' });
    expect(r.locale).toBe('en');
  });

  it('normalises case + region', () => {
    const r = resolveLocale({ override: 'HI-in' });
    expect(r.locale).toBe('hi-IN');
  });

  it('returns chain en-IN → en → en for an exact en-IN', () => {
    const r = resolveLocale({ override: 'en-IN' });
    expect(r.fallbackChain).toEqual(['en-IN', 'en']);
  });
});

describe('substitute', () => {
  it('replaces named placeholders', () => {
    expect(substitute('Hello {{name}}!', { name: 'Asha' })).toBe(
      'Hello Asha!',
    );
  });

  it('coerces numbers to string', () => {
    expect(substitute('₹{{amt}} refunded', { amt: 250 })).toBe(
      '₹250 refunded',
    );
  });

  it('leaves missing placeholders literal (loud miss)', () => {
    expect(substitute('Hi {{name}}, balance {{bal}}', { name: 'A' })).toBe(
      'Hi A, balance {{bal}}',
    );
  });

  it('does not interpret nested braces', () => {
    expect(substitute('json: {{{var}}}', { var: 'x' })).toBe('json: {x}');
  });
});

describe('MessageCatalogueService', () => {
  function setup(rows: Array<{ locale: string; key: string; body: string; shortBody?: string | null }>) {
    const fakePrisma: any = {
      i18nMessage: {
        findMany: jest.fn(async ({ where }) =>
          rows
            .filter((r) => r.locale === where.locale)
            .map((r) => ({ key: r.key, body: r.body, shortBody: r.shortBody ?? null })),
        ),
      },
    };
    return new MessageCatalogueService(fakePrisma);
  }

  it('returns the key itself on total miss (loud fallback)', async () => {
    const svc = setup([]);
    const out = await svc.render('returns.timeline.approved', {
      override: 'en',
    });
    expect(out.body).toBe('returns.timeline.approved');
  });

  it('walks fallback chain en-IN → en', async () => {
    const svc = setup([
      { locale: 'en', key: 'k', body: 'English fallback' },
    ]);
    const out = await svc.render('k', { override: 'en-IN' });
    expect(out.body).toBe('English fallback');
    expect(out.locale).toBe('en');
  });

  it('exact-match preferred over fallback', async () => {
    const svc = setup([
      { locale: 'en', key: 'k', body: 'English' },
      { locale: 'hi', key: 'k', body: 'Hindi' },
    ]);
    const out = await svc.render('k', { override: 'hi' });
    expect(out.body).toBe('Hindi');
    expect(out.locale).toBe('hi');
  });

  it('substitutes vars after lookup', async () => {
    const svc = setup([
      {
        locale: 'en',
        key: 'refund.complete',
        body: '₹{{amount}} refunded for {{order}}',
      },
    ]);
    const out = await svc.render(
      'refund.complete',
      { override: 'en' },
      { amount: 250, order: 'O-1' },
    );
    expect(out.body).toBe('₹250 refunded for O-1');
  });

  it('uses shortBody when caller asks for short=true', async () => {
    const svc = setup([
      {
        locale: 'en',
        key: 'k',
        body: 'A long body for email',
        shortBody: 'Short',
      },
    ]);
    const out = await svc.render(
      'k',
      { override: 'en' },
      {},
      { short: true },
    );
    expect(out.body).toBe('Short');
  });

  it('falls back to body when shortBody is null + short=true', async () => {
    const svc = setup([
      { locale: 'en', key: 'k', body: 'A long body', shortBody: null },
    ]);
    const out = await svc.render(
      'k',
      { override: 'en' },
      {},
      { short: true },
    );
    expect(out.body).toBe('A long body');
  });
});
