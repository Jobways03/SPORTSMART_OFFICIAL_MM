// Phase 68 (2026-05-22) — verification DTO bounds (audit Gap #18).

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ApproveOrderDto,
  BulkApproveGreenDto,
  ForceReleaseDto,
  RejectOrderDto,
  VerifyOrderDto,
  RejectOrderBodyDto,
} from './verification.dto';

function v(cls: any, payload: any) {
  const dto = plainToInstance(cls, payload);
  return { dto, errors: validateSync(dto, { whitelist: true }) };
}

describe('VerifyOrderDto / ApproveOrderDto / RejectOrderDto', () => {
  it.each([VerifyOrderDto, ApproveOrderDto, RejectOrderDto])(
    'accepts a no-remarks payload (%p)',
    (cls) => {
      const { errors } = v(cls, {});
      expect(errors).toEqual([]);
    },
  );

  it.each([VerifyOrderDto, ApproveOrderDto, RejectOrderDto])(
    'trims whitespace from remarks (%p)',
    (cls) => {
      const { dto, errors } = v(cls, { remarks: '   ok   ' });
      expect(errors).toEqual([]);
      expect((dto as any).remarks).toBe('ok');
    },
  );

  it.each([VerifyOrderDto, ApproveOrderDto, RejectOrderDto])(
    'rejects remarks over 500 chars (%p)',
    (cls) => {
      const { errors } = v(cls, { remarks: 'x'.repeat(501) });
      expect(errors[0]?.constraints?.maxLength).toMatch(/500/);
    },
  );
});

describe('ForceReleaseDto', () => {
  it('rejects an empty reason', () => {
    const { errors } = v(ForceReleaseDto, { reason: '' });
    expect(errors[0]?.constraints).toBeDefined();
  });
  it('rejects a 2-char reason', () => {
    const { errors } = v(ForceReleaseDto, { reason: 'ab' });
    expect(errors[0]?.constraints?.isLength).toMatch(/3-500/);
  });
  it('accepts a 3-char reason', () => {
    const { errors } = v(ForceReleaseDto, { reason: 'ok!' });
    expect(errors).toEqual([]);
  });
  it('rejects over 500-char reason', () => {
    const { errors } = v(ForceReleaseDto, { reason: 'y'.repeat(501) });
    expect(errors[0]?.constraints?.isLength).toMatch(/3-500/);
  });
});

describe('BulkApproveGreenDto', () => {
  it('accepts empty payload (defaults applied server-side)', () => {
    const { errors } = v(BulkApproveGreenDto, {});
    expect(errors).toEqual([]);
  });

  it('accepts limit=25 (max)', () => {
    const { errors } = v(BulkApproveGreenDto, { limit: 25 });
    expect(errors).toEqual([]);
  });

  it('accepts limit=26 (DTO ceiling is the absolute max=50; service clamps to env)', () => {
    const { errors } = v(BulkApproveGreenDto, { limit: 26 });
    expect(errors).toEqual([]);
  });

  it('rejects limit=51 (over absolute max)', () => {
    const { errors } = v(BulkApproveGreenDto, { limit: 51 });
    expect(errors[0]?.constraints?.max).toMatch(/50/);
  });

  it('rejects limit=0', () => {
    const { errors } = v(BulkApproveGreenDto, { limit: 0 });
    expect(errors[0]?.constraints?.min).toMatch(/at least 1/);
  });

  it('rejects non-integer limit', () => {
    const { errors } = v(BulkApproveGreenDto, { limit: 5.5 });
    expect(errors[0]?.constraints?.isInt).toBeDefined();
  });

  it('rejects string-typed limit', () => {
    const { errors } = v(BulkApproveGreenDto, { limit: '10' });
    expect(errors[0]?.constraints?.isInt).toBeDefined();
  });

  it('rejects non-boolean dryRun', () => {
    const { errors } = v(BulkApproveGreenDto, { dryRun: 'yes' });
    expect(errors[0]?.constraints?.isBoolean).toBeDefined();
  });

  it('accepts dryRun=true', () => {
    const { errors } = v(BulkApproveGreenDto, { dryRun: true });
    expect(errors).toEqual([]);
  });
});

describe('RejectOrderBodyDto (Phase 74 — Gap #2/#19)', () => {
  it('rejects missing reason', () => {
    const { errors } = v(RejectOrderBodyDto, {});
    expect(errors[0]?.constraints?.isString).toBeDefined();
  });

  it('rejects 9-char reason', () => {
    const { errors } = v(RejectOrderBodyDto, { reason: 'too short' });
    expect(errors[0]?.constraints?.isLength).toMatch(/10-500/);
  });

  it('accepts 10-char trimmed reason', () => {
    const { dto, errors } = v(RejectOrderBodyDto, { reason: '  longreason ' });
    expect(errors).toEqual([]);
    expect((dto as any).reason).toBe('longreason');
  });

  it('rejects over 500 chars', () => {
    const { errors } = v(RejectOrderBodyDto, { reason: 'x'.repeat(501) });
    expect(errors[0]?.constraints?.isLength).toMatch(/10-500/);
  });

  it('rejects whitespace-only reason', () => {
    const { errors } = v(RejectOrderBodyDto, { reason: '          ' });
    expect(errors[0]?.constraints?.isLength).toMatch(/10-500/);
  });
});
