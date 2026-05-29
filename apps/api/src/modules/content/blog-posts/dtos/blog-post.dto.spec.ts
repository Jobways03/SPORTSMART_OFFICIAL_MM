/**
 * Phase 50 (2026-05-21) — locks the blog DTO contract. These tests
 * guard against regression of the audit-driven hardening (tag count
 * cap, length caps, URL allowlist, slug regex, enum membership).
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BlogPostStatus } from '@prisma/client';
import { CreateBlogPostDto, UpdateBlogPostDto } from './blog-post.dto';

async function messages<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateBlogPostDto (Phase 50)', () => {
  it('accepts a valid minimal payload', async () => {
    const msgs = await messages(CreateBlogPostDto, { title: 'New shoes launch' });
    expect(msgs).toEqual([]);
  });

  it('rejects an empty title', async () => {
    const msgs = await messages(CreateBlogPostDto, { title: '   ' });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects title longer than 200 chars', async () => {
    const msgs = await messages(CreateBlogPostDto, { title: 'x'.repeat(201) });
    expect(msgs.some((m) => m.includes('200'))).toBe(true);
  });

  it('rejects contentHtml longer than 200KB', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      contentHtml: 'a'.repeat(200_001),
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects javascript: imageUrl', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      imageUrl: 'javascript:alert(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects protocol-relative //evil.com imageUrl', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      imageUrl: '//evil.com/hero.jpg',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts https imageUrl', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      imageUrl: 'https://res.cloudinary.com/x/img.jpg',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects more than 20 tags', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      tags: Array.from({ length: 21 }, (_, i) => `tag-${i}`),
    });
    expect(msgs.some((m) => m.toLowerCase().includes('20'))).toBe(true);
  });

  it('rejects duplicate tags at the DTO layer', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      tags: ['cricket', 'football', 'cricket'],
    });
    expect(msgs.some((m) => m.toLowerCase().includes('duplicate'))).toBe(true);
  });

  it('rejects a tag longer than 40 chars', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      tags: ['a'.repeat(41)],
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects an invalid status', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      status: 'WHATEVER' as any,
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts every BlogPostStatus enum value', async () => {
    for (const status of Object.values(BlogPostStatus)) {
      const msgs = await messages(CreateBlogPostDto, { title: 'X', status });
      expect(msgs).toEqual([]);
    }
  });

  it('rejects an uppercase slug', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      slug: 'MyPost',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('slug'))).toBe(true);
  });

  it('rejects path-traversal-looking slug', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      slug: '../admin',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts a valid slug', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      slug: 'my-new-post',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects imageAlt longer than 160 chars', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      imageAlt: 'a'.repeat(161),
    });
    expect(msgs.some((m) => m.includes('160'))).toBe(true);
  });

  it('rejects javascript: canonicalUrl', async () => {
    const msgs = await messages(CreateBlogPostDto, {
      title: 'X',
      canonicalUrl: 'javascript:alert(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('UpdateBlogPostDto (Phase 50)', () => {
  it('accepts an empty payload', async () => {
    const msgs = await messages(UpdateBlogPostDto, {});
    expect(msgs).toEqual([]);
  });

  it('rejects javascript: ogImage on update', async () => {
    const msgs = await messages(UpdateBlogPostDto, {
      ogImage: 'javascript:alert(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts an empty tags array (clears tags)', async () => {
    const msgs = await messages(UpdateBlogPostDto, { tags: [] });
    expect(msgs).toEqual([]);
  });
});
