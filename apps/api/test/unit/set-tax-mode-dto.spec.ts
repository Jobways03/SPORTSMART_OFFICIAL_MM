import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetTaxModeDto } from '../../src/modules/tax/presentation/dtos/set-tax-mode.dto';

/** Phase 159w (GST Mode Toggle audit #6) — DTO validation on POST /admin/tax/mode. */
describe('SetTaxModeDto', () => {
  const errs = (body: any) => validate(plainToInstance(SetTaxModeDto, body));
  const has = (es: any[], p: string) => es.some((e) => e.property === p);

  it.each(['OFF', 'AUDIT', 'STRICT'])('accepts mode %s', async (mode) => {
    expect(has(await errs({ mode }), 'mode')).toBe(false);
  });

  it('rejects an unknown mode', async () => {
    expect(has(await errs({ mode: 'ON' }), 'mode')).toBe(true);
  });

  it('rejects a missing mode', async () => {
    expect(has(await errs({}), 'mode')).toBe(true);
  });

  it('accepts an optional reason + force', async () => {
    const es = await errs({ mode: 'STRICT', reason: 'CA signed off', force: true });
    expect(es.length).toBe(0);
  });

  it('rejects a reason over 500 chars', async () => {
    expect(has(await errs({ mode: 'OFF', reason: 'x'.repeat(501) }), 'reason')).toBe(true);
  });

  it('rejects a non-boolean force', async () => {
    expect(has(await errs({ mode: 'STRICT', force: 'yes' }), 'force')).toBe(true);
  });
});
