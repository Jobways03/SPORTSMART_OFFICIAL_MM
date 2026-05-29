/**
 * Phase 42 (2026-05-21) — locks the collision-handling contract on
 * MasterSkuService.generateMasterSkuBatch. Closes audit gap #3:
 * pre-Phase-42 two color values that truncated to the same 3-char
 * abbreviation ("Red Cherry" + "Red Rose" both → "RED") collided on
 * the unique masterSku and rolled back the whole variant batch.
 */

import { MasterSkuService } from './master-sku.service';

function makeRepo(values: Array<{ id: string; value: string; type: string }>) {
  return {
    findOptionValuesByIds: jest.fn(async (ids: string[]) =>
      ids
        .map((id) => values.find((v) => v.id === id))
        .filter((v): v is { id: string; value: string; type: string } => Boolean(v))
        .map((v) => ({
          id: v.id,
          value: v.value,
          optionDefinition: { type: v.type },
        })),
    ),
  } as any;
}

describe('MasterSkuService.generateMasterSkuBatch', () => {
  it('returns empty array for empty input', async () => {
    const svc = new MasterSkuService(makeRepo([]));
    const out = await svc.generateMasterSkuBatch('PRD-001', []);
    expect(out).toEqual([]);
  });

  it('handles non-colliding combos without disambiguators', async () => {
    const repo = makeRepo([
      { id: 'red', value: 'Red', type: 'COLOR' },
      { id: 'blue', value: 'Blue', type: 'COLOR' },
      { id: 'sm', value: 'S', type: 'SIZE' },
      { id: 'md', value: 'M', type: 'SIZE' },
    ]);
    const svc = new MasterSkuService(repo);
    const out = await svc.generateMasterSkuBatch('PRD-001', [
      ['red', 'sm'],
      ['blue', 'md'],
    ]);
    expect(out).toEqual(['PRD-001-RED-S', 'PRD-001-BLU-M']);
  });

  it('disambiguates COLOR values that truncate to the same token', async () => {
    // The exact audit-cited failure mode.
    const repo = makeRepo([
      { id: '11111111-1111-1111-1111-111111111111', value: 'Red Cherry', type: 'COLOR' },
      { id: '22222222-2222-2222-2222-222222222222', value: 'Red Rose', type: 'COLOR' },
      { id: 'sm', value: 'S', type: 'SIZE' },
    ]);
    const svc = new MasterSkuService(repo);
    const out = await svc.generateMasterSkuBatch('PRD-001', [
      ['11111111-1111-1111-1111-111111111111', 'sm'],
      ['22222222-2222-2222-2222-222222222222', 'sm'],
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).not.toEqual(out[1]);
    // Both keep the RED prefix; the 4-char UUID suffix disambiguates.
    expect(out[0]).toMatch(/^PRD-001-RED[A-F0-9]{4}-S$/);
    expect(out[1]).toMatch(/^PRD-001-RED[A-F0-9]{4}-S$/);
  });

  it('keeps SIZE unaltered (no truncation)', async () => {
    const repo = makeRepo([
      { id: 's-xl', value: 'XL', type: 'SIZE' },
      { id: 's-8uk', value: '8 UK', type: 'SIZE' },
    ]);
    const svc = new MasterSkuService(repo);
    const out = await svc.generateMasterSkuBatch('PRD-001', [['s-xl'], ['s-8uk']]);
    expect(out).toEqual(['PRD-001-XL', 'PRD-001-8UK']);
  });

  it('only disambiguates the colliding axis, leaves others alone', async () => {
    const repo = makeRepo([
      { id: '11111111-1111-1111-1111-111111111111', value: 'Red Cherry', type: 'COLOR' },
      { id: '22222222-2222-2222-2222-222222222222', value: 'Red Rose', type: 'COLOR' },
      { id: 'sm', value: 'S', type: 'SIZE' },
      { id: 'md', value: 'M', type: 'SIZE' },
    ]);
    const svc = new MasterSkuService(repo);
    const out = await svc.generateMasterSkuBatch('PRD-001', [
      ['11111111-1111-1111-1111-111111111111', 'sm'],
      ['11111111-1111-1111-1111-111111111111', 'md'],
      ['22222222-2222-2222-2222-222222222222', 'sm'],
      ['22222222-2222-2222-2222-222222222222', 'md'],
    ]);
    // Color slot disambiguated; size slot stays plain.
    expect(new Set(out).size).toEqual(out.length);
    for (const sku of out) {
      expect(sku).toMatch(/^PRD-001-RED[A-F0-9]{4}-[SM]$/);
    }
  });

  it('throws when an option value id is unknown', async () => {
    const svc = new MasterSkuService(makeRepo([]));
    await expect(
      svc.generateMasterSkuBatch('PRD-001', [['missing-id']]),
    ).rejects.toThrow(/Unknown option value id/);
  });
});

describe('MasterSkuService.abbreviate', () => {
  it('keeps SIZE values intact, stripped + uppercased', () => {
    expect(MasterSkuService.abbreviate('XL', 'SIZE')).toBe('XL');
    expect(MasterSkuService.abbreviate('8 UK', 'SIZE')).toBe('8UK');
  });

  it('truncates COLOR + GENERIC to 3 chars uppercased', () => {
    expect(MasterSkuService.abbreviate('Red Cherry', 'COLOR')).toBe('RED');
    expect(MasterSkuService.abbreviate('Red Rose', 'COLOR')).toBe('RED');
    expect(MasterSkuService.abbreviate('Premium Cotton', 'GENERIC')).toBe('PRE');
  });
});
