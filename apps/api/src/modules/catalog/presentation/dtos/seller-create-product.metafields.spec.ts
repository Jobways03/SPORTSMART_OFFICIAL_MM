/**
 * Regression — SellerMetafieldValueDto.value must be whitelisted.
 *
 * Bug: the global ValidationPipe runs with { whitelist: true,
 * forbidNonWhitelisted: true } (apps/api/src/main.ts). The DTO's
 * `value` property had NO class-validator decorator, so every product
 * create/edit that supplied category metafield values was rejected with
 * "property value should not exist" (one error per metafield entry).
 *
 * The fix adds @Allow() to `value` so the property is whitelisted
 * without constraining its (type-dependent) shape — the real type
 * checking lives in MetafieldValidationService.
 *
 * These tests reproduce the global-pipe options exactly, so they fail
 * on the pre-fix DTO and pass after it.
 */

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SellerMetafieldValueDto } from './seller-create-product.dto';

// Mirror apps/api/src/main.ts ValidationPipe configuration.
const PIPE_OPTS = { whitelist: true, forbidNonWhitelisted: true } as const;

async function validateMetafield(input: unknown): Promise<string[]> {
  const dto = plainToInstance(SellerMetafieldValueDto, input);
  const errors = await validate(dto as object, PIPE_OPTS);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const uuid = '00000000-0000-4000-8000-000000000001';

describe('SellerMetafieldValueDto — value whitelisting', () => {
  it('accepts an entry that carries a value (string)', async () => {
    const errors = await validateMetafield({
      definitionId: uuid,
      namespace: 'specs',
      key: 'sole_type',
      value: 'rubber',
    });
    expect(errors).toEqual([]);
  });

  it('accepts non-string value shapes (number / boolean / array)', async () => {
    for (const value of [42, true, ['a', 'b']]) {
      const errors = await validateMetafield({
        namespace: 'specs',
        key: 'weight',
        value,
      });
      expect(errors).toEqual([]);
    }
  });

  it('does NOT reject the value property as non-whitelisted', async () => {
    const errors = await validateMetafield({
      namespace: 'specs',
      key: 'sole_type',
      value: 'rubber',
    });
    // The original bug surfaced as this exact message.
    expect(errors.some((m) => /should not exist/.test(m))).toBe(false);
  });

  it('still rejects a genuinely unknown property (whitelist intact)', async () => {
    const errors = await validateMetafield({
      namespace: 'specs',
      key: 'sole_type',
      value: 'rubber',
      bogus: 'nope',
    });
    expect(errors.some((m) => /should not exist/.test(m))).toBe(true);
  });
});
