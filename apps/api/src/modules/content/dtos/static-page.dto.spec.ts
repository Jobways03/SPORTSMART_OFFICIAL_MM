/**
 * Phase 49 (2026-05-21) — locks the static-page DTO contract:
 *   - slug regex on create
 *   - SEO field allowlist (canonicalUrl / ogImage reject javascript:
 *     and protocol-relative `//evil.com`)
 *   - status enum
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PageStatus } from '@prisma/client';
import { CreateStaticPageDto, UpdateStaticPageDto } from './static-page.dto';

async function messages<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateStaticPageDto (Phase 49)', () => {
  it('accepts a valid minimal payload', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: 'refund-policy',
      title: 'Refund Policy',
      body: '<p>Hello</p>',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects an uppercase slug', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: 'Refund-Policy',
      title: 'X',
      body: '<p>X</p>',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('slug'))).toBe(true);
  });

  it('rejects a slug with a space', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: 'refund policy',
      title: 'X',
      body: '<p>X</p>',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects path-traversal-looking slug', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: '../admin',
      title: 'X',
      body: '<p>X</p>',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects a javascript: canonicalUrl', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: 'x',
      title: 'X',
      body: '<p>X</p>',
      canonicalUrl: 'javascript:alert(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects protocol-relative //evil.com ogImage', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: 'x',
      title: 'X',
      body: '<p>X</p>',
      ogImage: '//evil.com/hero.jpg',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts https ogImage', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: 'x',
      title: 'X',
      body: '<p>X</p>',
      ogImage: 'https://res.cloudinary.com/x/og.jpg',
    });
    expect(msgs).toEqual([]);
  });

  it('accepts every PageStatus enum value', async () => {
    for (const status of Object.values(PageStatus)) {
      const msgs = await messages(CreateStaticPageDto, {
        slug: 'x',
        title: 'X',
        body: '<p>X</p>',
        status,
      });
      expect(msgs).toEqual([]);
    }
  });

  it('rejects body longer than 100KB', async () => {
    const msgs = await messages(CreateStaticPageDto, {
      slug: 'x',
      title: 'X',
      body: 'a'.repeat(100_001),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('UpdateStaticPageDto (Phase 49)', () => {
  it('accepts an empty payload', async () => {
    const msgs = await messages(UpdateStaticPageDto, {});
    expect(msgs).toEqual([]);
  });

  it('rejects javascript: canonicalUrl on update', async () => {
    const msgs = await messages(UpdateStaticPageDto, {
      canonicalUrl: 'javascript:alert(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
