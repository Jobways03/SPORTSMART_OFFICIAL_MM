/**
 * Phase 48 (2026-05-21) — locks the storefront-menu DTO contract.
 * Tests sit at the controller's first gate: any future change that
 * loosens the href allowlist or the per-linkType linkRef rules will
 * trip these.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MenuLinkType } from '@prisma/client';
import {
  CreateItemDto,
  CreateMenuDto,
  UpdateItemDto,
  UpdateMenuDto,
} from './menu.dto';

async function messages<T extends object>(
  cls: new () => T,
  input: unknown,
): Promise<string[]> {
  const dto = plainToInstance(cls, input);
  const errs = await validate(dto as object);
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

const uuid = '00000000-0000-4000-8000-000000000001';

describe('CreateMenuDto (Phase 48)', () => {
  it('accepts a valid handle + name', async () => {
    const msgs = await messages(CreateMenuDto, { handle: 'main-menu', name: 'Main Menu' });
    expect(msgs).toEqual([]);
  });

  it('rejects uppercase in handle', async () => {
    const msgs = await messages(CreateMenuDto, { handle: 'MainMenu', name: 'X' });
    expect(msgs.some((m) => m.includes('handle'))).toBe(true);
  });

  it('rejects spaces in handle', async () => {
    const msgs = await messages(CreateMenuDto, { handle: 'main menu', name: 'X' });
    expect(msgs.some((m) => m.includes('handle'))).toBe(true);
  });

  it('rejects a handle starting with a digit', async () => {
    const msgs = await messages(CreateMenuDto, { handle: '1-main', name: 'X' });
    expect(msgs.some((m) => m.includes('handle'))).toBe(true);
  });

  it('rejects a handle > 64 chars', async () => {
    const msgs = await messages(CreateMenuDto, {
      handle: 'a' + 'b'.repeat(64),
      name: 'X',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects an empty name', async () => {
    const msgs = await messages(CreateMenuDto, { handle: 'main', name: '   ' });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('UpdateMenuDto (Phase 48)', () => {
  it('accepts an empty payload', async () => {
    const msgs = await messages(UpdateMenuDto, {});
    expect(msgs).toEqual([]);
  });

  it('accepts isActive=false', async () => {
    const msgs = await messages(UpdateMenuDto, { isActive: false });
    expect(msgs).toEqual([]);
  });

  it('rejects an invalid handle even on partial update', async () => {
    const msgs = await messages(UpdateMenuDto, { handle: 'Bad Handle' });
    expect(msgs.length).toBeGreaterThan(0);
  });
});

describe('CreateItemDto (Phase 48)', () => {
  it('accepts label only (linkType defaults to NONE)', async () => {
    const msgs = await messages(CreateItemDto, { label: 'Sports' });
    expect(msgs).toEqual([]);
  });

  it('rejects label > 80 chars', async () => {
    const msgs = await messages(CreateItemDto, { label: 'a'.repeat(81) });
    expect(msgs.some((m) => m.includes('80'))).toBe(true);
  });

  it('rejects empty label', async () => {
    const msgs = await messages(CreateItemDto, { label: '' });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects javascript: linkRef for linkType=URL', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Hack',
      linkType: MenuLinkType.URL,
      linkRef: 'javascript:alert(1)',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('http'))).toBe(true);
  });

  it('rejects data: linkRef for linkType=URL', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Hack',
      linkType: MenuLinkType.URL,
      linkRef: 'data:text/html;base64,PHNjcmlwdD4=',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects protocol-relative //evil.com linkRef', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Hack',
      linkType: MenuLinkType.URL,
      linkRef: '//evil.com/path',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('accepts relative path for linkType=URL', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Sale',
      linkType: MenuLinkType.URL,
      linkRef: '/sale',
    });
    expect(msgs).toEqual([]);
  });

  it('accepts https URL for linkType=URL', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Partner',
      linkType: MenuLinkType.URL,
      linkRef: 'https://partner.example.com/page',
    });
    expect(msgs).toEqual([]);
  });

  it('rejects non-UUID linkRef when linkType=CATEGORY', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Cricket',
      linkType: MenuLinkType.CATEGORY,
      linkRef: 'cricket-slug',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('accepts UUID linkRef when linkType=CATEGORY', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Cricket',
      linkType: MenuLinkType.CATEGORY,
      linkRef: uuid,
    });
    expect(msgs).toEqual([]);
  });

  it('rejects non-UUID linkRef when linkType=BRAND', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Nike',
      linkType: MenuLinkType.BRAND,
      linkRef: 'nike',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });

  it('rejects non-slug linkRef when linkType=PAGE', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'About',
      linkType: MenuLinkType.PAGE,
      linkRef: 'About Us',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('slug'))).toBe(true);
  });

  it('accepts slug linkRef when linkType=PAGE', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'About',
      linkType: MenuLinkType.PAGE,
      linkRef: 'about-us',
    });
    expect(msgs).toEqual([]);
  });

  it('accepts NONE without linkRef', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Header',
      linkType: MenuLinkType.NONE,
    });
    expect(msgs).toEqual([]);
  });

  it('accepts isActive + openInNewTab + relNofollow', async () => {
    const msgs = await messages(CreateItemDto, {
      label: 'Promo',
      linkType: MenuLinkType.URL,
      linkRef: 'https://partner.example.com',
      isActive: false,
      openInNewTab: true,
      relNofollow: true,
    });
    expect(msgs).toEqual([]);
  });
});

describe('UpdateItemDto (Phase 48)', () => {
  it('accepts an empty payload', async () => {
    const msgs = await messages(UpdateItemDto, {});
    expect(msgs).toEqual([]);
  });

  it('rejects javascript: linkRef on update', async () => {
    const msgs = await messages(UpdateItemDto, {
      linkType: MenuLinkType.URL,
      linkRef: 'javascript:alert(1)',
    });
    expect(msgs.length).toBeGreaterThan(0);
  });

  it('rejects non-UUID linkRef on update when linkType=PRODUCT', async () => {
    const msgs = await messages(UpdateItemDto, {
      linkType: MenuLinkType.PRODUCT,
      linkRef: 'product-handle',
    });
    expect(msgs.some((m) => m.toLowerCase().includes('uuid'))).toBe(true);
  });
});
