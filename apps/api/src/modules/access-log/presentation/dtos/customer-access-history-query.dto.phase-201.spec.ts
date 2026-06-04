import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerAccessHistoryQueryDto } from './customer-access-history-query.dto';

/**
 * Phase 201 (#3 / #12) — the limit query param must be a bounded int.
 * Previously `parseInt('abc')` → NaN → Prisma `take: NaN`.
 */
describe('CustomerAccessHistoryQueryDto — Phase 201', () => {
  async function check(input: Record<string, unknown>) {
    const dto = plainToInstance(CustomerAccessHistoryQueryDto, input, {
      enableImplicitConversion: false,
    });
    const errors = await validate(dto);
    return { dto, errors };
  }

  it('accepts a valid numeric limit (coerced from the query string)', async () => {
    const { dto, errors } = await check({ limit: '50' });
    expect(errors).toHaveLength(0);
    expect(dto.limit).toBe(50);
    expect(typeof dto.limit).toBe('number');
  });

  it('allows omitting limit (optional)', async () => {
    const { errors } = await check({});
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-numeric limit (the NaN bug)', async () => {
    const { errors } = await check({ limit: 'abc' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects limit below 1', async () => {
    const { errors } = await check({ limit: '0' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects limit above 500', async () => {
    const { errors } = await check({ limit: '501' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
