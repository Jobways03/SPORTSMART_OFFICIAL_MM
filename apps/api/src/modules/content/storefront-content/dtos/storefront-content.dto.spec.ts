/**
 * Phase 47 (2026-05-21) — locks the URL-scheme allowlist + length
 * caps for the storefront slot + content DTOs. These DTOs are the
 * pre-controller gate; if they ever loosen, an admin could persist a
 * `javascript:` href that the storefront's `<a href>` would render.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateSlotDto,
  UpsertStorefrontContentDto,
  ALLOWED_SECTION_KEYS,
} from './storefront-content.dto';

async function messages<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateSlotDto (Phase 47)', () => {
  it('accepts a minimal valid payload', async () => {
    const msgs = await messages(CreateSlotDto, {
      sectionKey: 'hero',
      label: 'Hero Slide 5',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects an unknown sectionKey', async () => {
    const msgs = await messages(CreateSlotDto, {
      sectionKey: 'mystery-section',
      label: 'Hero Slide 5',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts every known section in ALLOWED_SECTION_KEYS', async () => {
    for (const key of ALLOWED_SECTION_KEYS) {
      const msgs = await messages(CreateSlotDto, { sectionKey: key, label: 'L' });
      expect(msgs).toEqual([]);
    }
  });

  it('rejects an empty label', async () => {
    const msgs = await messages(CreateSlotDto, { sectionKey: 'hero', label: '' });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects a label > 80 chars', async () => {
    const msgs = await messages(CreateSlotDto, {
      sectionKey: 'hero',
      label: 'x'.repeat(81),
    });
    expect(msgs.some((m) => m.toLowerCase().includes('80'))).toBe(true);
  });

  it('rejects a javascript: defaultHref', async () => {
    const msgs = await messages(CreateSlotDto, {
      sectionKey: 'hero',
      label: 'L',
      defaultHref: 'javascript:alert(1)',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('http'))).toBe(true);
  });

  it('rejects a data: defaultHref', async () => {
    const msgs = await messages(CreateSlotDto, {
      sectionKey: 'hero',
      label: 'L',
      defaultHref: 'data:text/html;base64,PHNjcmlwdD4=',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts a relative defaultHref', async () => {
    const msgs = await messages(CreateSlotDto, {
      sectionKey: 'hero',
      label: 'L',
      defaultHref: '/collections/cricket',
    });
    expect(msgs).toEqual([]);
  });

  it('accepts an https defaultHref', async () => {
    const msgs = await messages(CreateSlotDto, {
      sectionKey: 'hero',
      label: 'L',
      defaultHref: 'https://sportsmart.example.com/sale',
    });
    expect(msgs).toEqual([]);
  });
});

describe('UpsertStorefrontContentDto (Phase 47)', () => {
  it('accepts an empty payload (every field is optional)', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {});
    expect(msgs).toEqual([]);
  });

  it('rejects a javascript: ctaHref', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      ctaHref: 'javascript:alert(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects a vbscript: ctaHref', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      ctaHref: 'vbscript:msgbox(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects a data: imageUrl', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts a Cloudinary-style https imageUrl', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      imageUrl: 'https://res.cloudinary.com/sportsmart/image/upload/v1/test.jpg',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects imageAlt longer than 160 chars', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      imageAlt: 'a'.repeat(161),
    });
    expect(msgs.some((m) => m.toLowerCase().includes('160'))).toBe(true);
  });

  it('rejects headline longer than 120 chars', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      headline: 'x'.repeat(121),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects malformed startAt', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      startAt: 'not-a-date',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts ISO-8601 startAt + endAt', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      startAt: '2026-06-01T00:00:00.000Z',
      endAt: '2026-06-30T23:59:59.000Z',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects non-boolean active', async () => {
    const msgs = await messages(UpsertStorefrontContentDto, {
      active: 'yes' as any,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});
