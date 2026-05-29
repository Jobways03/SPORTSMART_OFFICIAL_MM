import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PosReportQueryDto } from '../../src/modules/franchise/presentation/dtos/pos-report-query.dto';

/** Phase 159s (POS report audit #10) — report date query validation. */
describe('PosReportQueryDto', () => {
  it('rejects a garbage date', async () => {
    const errors = await validate(plainToInstance(PosReportQueryDto, { date: 'garbage' }));
    expect(errors.some((e) => e.property === 'date')).toBe(true);
  });

  it('rejects a non-date-shaped value', async () => {
    const errors = await validate(plainToInstance(PosReportQueryDto, { date: '2026/05/23' }));
    expect(errors.some((e) => e.property === 'date')).toBe(true);
  });

  it('accepts a YYYY-MM-DD date', async () => {
    const errors = await validate(plainToInstance(PosReportQueryDto, { date: '2026-05-23' }));
    expect(errors.length).toBe(0);
  });

  it('accepts an omitted date (defaults to today in the service)', async () => {
    const errors = await validate(plainToInstance(PosReportQueryDto, {}));
    expect(errors.length).toBe(0);
  });

  it('rejects an invalid format value', async () => {
    const errors = await validate(plainToInstance(PosReportQueryDto, { format: 'xml' }));
    expect(errors.some((e) => e.property === 'format')).toBe(true);
  });
});
