import 'reflect-metadata';

/**
 * Phase 5 (PR 5.3) — Wire-up regression test.
 *
 * The R1 case-duplicate check on createReturn must run BEFORE
 * generateNextReturnNumber so a duplicate doesn't burn a sequence
 * number. We can't easily exercise the full return-creation path
 * without a live DB, but we can read the file and assert the call
 * order: the assertNoActiveReturnForOrderItem invocation appears
 * before generateNextReturnNumber.
 *
 * Static-analysis style test, but cheap to run and catches the most
 * common refactoring regression (someone moves the duplicate check
 * to "after we have a number" and reintroduces the wasted-sequence
 * bug).
 */
import * as fs from 'fs';
import * as path from 'path';

describe('createReturn — duplicate-guard wiring', () => {
  const SOURCE = path.resolve(
    __dirname,
    '../../src/modules/returns/application/services/return.service.ts',
  );

  let body: string;

  beforeAll(() => {
    body = fs.readFileSync(SOURCE, 'utf8');
  });

  it('declares CaseDuplicateService as a constructor dependency', () => {
    expect(body).toMatch(/caseDuplicates:\s*CaseDuplicateService/);
  });

  it('asserts no active return per orderItem in createReturn', () => {
    expect(body).toMatch(/assertNoActiveReturnForOrderItem/);
  });

  it('runs the duplicate check BEFORE generateNextReturnNumber', () => {
    // Match the actual call site (`returnRepo.generateNextReturnNumber()`)
    // so a comment that mentions the method name doesn't confuse indexOf.
    const checkIdx = body.indexOf('assertNoActiveReturnForOrderItem');
    const seqIdx = body.indexOf('returnRepo.generateNextReturnNumber()');
    expect(checkIdx).toBeGreaterThan(0);
    expect(seqIdx).toBeGreaterThan(0);
    expect(checkIdx).toBeLessThan(seqIdx);
  });
});
