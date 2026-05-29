/**
 * Phase 40 (2026-05-21) — locks the scrub behaviour of
 * StorefrontFilterValidatorService:
 *   - built-in keys pass through
 *   - unknown keys are dropped
 *   - SELECT values outside choices[] are dropped
 *   - numeric values that aren't finite are dropped
 *   - empty result after scrub drops the key entirely
 */

import { StorefrontFilterValidatorService } from './storefront-filter-validator.service';

function makeService(opts: {
  ancestors?: string[];
  defByKey?: Record<string, any | null>;
} = {}) {
  const metafieldRepo: any = {
    findDefinitionByKeyForCategoryHierarchy: jest.fn((key: string) =>
      Promise.resolve(opts.defByKey?.[key] ?? null),
    ),
  };
  const categoryRepo: any = {
    findAncestorIds: jest.fn().mockResolvedValue(opts.ancestors ?? []),
  };
  return new StorefrontFilterValidatorService(metafieldRepo, categoryRepo);
}

describe('StorefrontFilterValidatorService.scrub', () => {
  it('returns empty map when input is empty', async () => {
    const svc = makeService();
    const result = await svc.scrub(new Map());
    expect(result.size).toBe(0);
  });

  it('passes built-in keys (brand, availability, price_range) through unchanged', async () => {
    const svc = makeService({ ancestors: ['cat-1'] });
    const result = await svc.scrub(
      new Map([
        ['brand', ['nike']],
        ['availability', ['in_stock']],
      ]),
      'cat-1',
    );
    expect(result.get('brand')).toEqual(['nike']);
    expect(result.get('availability')).toEqual(['in_stock']);
  });

  it('passes through when no category context (no ancestors)', async () => {
    const svc = makeService({ ancestors: [] });
    const result = await svc.scrub(new Map([['material', ['cotton']]]));
    expect(result.get('material')).toEqual(['cotton']);
  });

  it('drops unknown keys when category provided', async () => {
    const svc = makeService({ ancestors: ['cat-1'], defByKey: {} });
    const result = await svc.scrub(new Map([['unknown', ['x']]]), 'cat-1');
    expect(result.has('unknown')).toBe(false);
  });

  it('keeps SINGLE_SELECT values that are in choices, drops others', async () => {
    const svc = makeService({
      ancestors: ['cat-1'],
      defByKey: {
        color: { type: 'SINGLE_SELECT', choices: [{ value: 'red' }, { value: 'blue' }] },
      },
    });
    const result = await svc.scrub(new Map([['color', ['red', 'green']]]), 'cat-1');
    expect(result.get('color')).toEqual(['red']);
  });

  it('drops a SELECT key entirely when no value matches', async () => {
    const svc = makeService({
      ancestors: ['cat-1'],
      defByKey: {
        color: { type: 'SINGLE_SELECT', choices: [{ value: 'red' }] },
      },
    });
    const result = await svc.scrub(new Map([['color', ['green', 'purple']]]), 'cat-1');
    expect(result.has('color')).toBe(false);
  });

  it('keeps numeric values for NUMBER_DECIMAL, drops non-finite', async () => {
    const svc = makeService({
      ancestors: ['cat-1'],
      defByKey: { weight: { type: 'NUMBER_DECIMAL', choices: null } },
    });
    const result = await svc.scrub(new Map([['weight', ['1.5', 'abc', '2.0']]]), 'cat-1');
    expect(result.get('weight')).toEqual(['1.5', '2.0']);
  });

  it('drops numeric key entirely when no value is finite', async () => {
    const svc = makeService({
      ancestors: ['cat-1'],
      defByKey: { rating: { type: 'RATING' } },
    });
    const result = await svc.scrub(new Map([['rating', ['abc', 'xyz']]]), 'cat-1');
    expect(result.has('rating')).toBe(false);
  });

  it('passes BOOLEAN / TEXT values without choice check', async () => {
    const svc = makeService({
      ancestors: ['cat-1'],
      defByKey: { isWaterproof: { type: 'BOOLEAN' } },
    });
    const result = await svc.scrub(new Map([['isWaterproof', ['true']]]), 'cat-1');
    expect(result.get('isWaterproof')).toEqual(['true']);
  });
});

describe('StorefrontFilterValidatorService.scrubFilterObj', () => {
  it('round-trips through comma-separated string format', async () => {
    const svc = makeService({
      ancestors: ['cat-1'],
      defByKey: {
        color: { type: 'SINGLE_SELECT', choices: [{ value: 'red' }, { value: 'blue' }] },
      },
    });
    const result = await svc.scrubFilterObj({ color: 'red,green,blue' }, 'cat-1');
    expect(result.color).toEqual('red,blue');
  });

  it('omits keys dropped during scrub', async () => {
    const svc = makeService({ ancestors: ['cat-1'], defByKey: { material: null } });
    const result = await svc.scrubFilterObj({ material: 'cotton', brand: 'nike' }, 'cat-1');
    expect(result.material).toBeUndefined();
    expect(result.brand).toEqual('nike');
  });
});
