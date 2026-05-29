// Phase 140 — commission CSV export hardening. exportCommissionRecords now:
// interprets bare YYYY-MM-DD dates as Asia/Kolkata day boundaries, supports the
// drill-down filters (adjustedOnly / reversedOnly / subOrderId / productId /
// settlementStatus), joins the adjusting admin's name, and writes a forensic
// audit_logs row (commission.exported) when an actor is supplied.

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CommissionProcessorService } from '../../src/modules/commission/application/services/commission-processor.service';
import { ExportCommissionDto } from '../../src/modules/commission/presentation/dtos/export-commission.dto';

function build(opts: { count?: number; rows?: any[] } = {}) {
  const count = jest.fn().mockResolvedValue(opts.count ?? 0);
  const findMany = jest.fn().mockResolvedValue(opts.rows ?? []);
  const prisma = { commissionRecord: { count, findMany } };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const logger = { error: jest.fn(), log: jest.fn() };
  const svc = new CommissionProcessorService(
    {} as any,
    {} as any,
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    audit as any,
  );
  // silence the injected Nest logger
  (svc as any).logger = logger;
  return { svc, count, findMany, audit };
}

describe('CommissionProcessorService.exportCommissionRecords (Phase 140)', () => {
  it('interprets bare YYYY-MM-DD dates as Asia/Kolkata (+05:30) day boundaries', async () => {
    const { svc, findMany } = build();
    await svc.exportCommissionRecords({ dateFrom: '2026-05-22', dateTo: '2026-05-22' });
    const where = findMany.mock.calls[0][0].where;
    // IST midnight 2026-05-22 == 2026-05-21T18:30:00.000Z
    expect(where.createdAt.gte.toISOString()).toBe('2026-05-21T18:30:00.000Z');
    // IST 2026-05-22 23:59:59.999 == 2026-05-22T18:29:59.999Z
    expect(where.createdAt.lte.toISOString()).toBe('2026-05-22T18:29:59.999Z');
  });

  it('maps the drill-down filters to Prisma where clauses', async () => {
    const { svc, findMany } = build();
    await svc.exportCommissionRecords({
      adjustedOnly: true,
      reversedOnly: true,
      subOrderId: 'so1',
      productId: 'p1',
      settlementStatus: 'PAID',
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.adjustedAt).toEqual({ not: null });
    expect(where.refundedAdminEarning).toEqual({ gt: 0 });
    expect(where.subOrderId).toBe('so1');
    expect(where.productId).toBe('p1');
    expect(where.sellerSettlement).toEqual({ status: 'PAID' });
  });

  it('joins the adjusting admin name (FK) for the CSV', async () => {
    const { svc, findMany } = build();
    await svc.exportCommissionRecords({});
    expect(findMany.mock.calls[0][0].include.adjustedByAdmin).toEqual({
      select: { name: true, email: true },
    });
  });

  it('writes a forensic audit row with rowCount + filters when an actor is given', async () => {
    const { svc, audit } = build({ count: 2, rows: [{ id: 'a' }, { id: 'b' }] });
    await svc.exportCommissionRecords(
      { sellerId: 's1', status: 'PENDING' },
      { adminId: 'admin1' },
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin1',
        action: 'commission.exported',
        resource: 'commission_records',
        newValue: expect.objectContaining({
          rowCount: 2,
          total: 2,
          truncated: false,
          filters: expect.objectContaining({ sellerId: 's1', status: 'PENDING' }),
        }),
      }),
    );
  });

  it('does NOT write an audit row when no actor is supplied', async () => {
    const { svc, audit } = build();
    await svc.exportCommissionRecords({});
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('flags truncation when the total exceeds the returned rows', async () => {
    const { svc } = build({ count: 60_000, rows: new Array(50_000).fill({ id: 'x' }) });
    const res = await svc.exportCommissionRecords({});
    expect(res.truncated).toBe(true);
    expect(res.total).toBe(60_000);
  });
});

describe('ExportCommissionDto validation (Phase 140)', () => {
  it('rejects a garbage dateFrom (no longer a 500 at the Prisma layer)', async () => {
    const dto = plainToInstance(ExportCommissionDto, { dateFrom: 'garbage' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'dateFrom')).toBe(true);
  });

  it('rejects an invalid status enum', async () => {
    const dto = plainToInstance(ExportCommissionDto, { status: 'NOT_A_STATUS' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('rejects a non-UUID sellerId and an over-long search', async () => {
    const dto = plainToInstance(ExportCommissionDto, {
      sellerId: 'not-a-uuid',
      search: 'x'.repeat(81),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sellerId')).toBe(true);
    expect(errors.some((e) => e.property === 'search')).toBe(true);
  });

  it('coerces string booleans correctly (false stays false)', async () => {
    const dto = plainToInstance(ExportCommissionDto, {
      adjustedOnly: 'true',
      reversedOnly: 'false',
    });
    expect(dto.adjustedOnly).toBe(true);
    expect(dto.reversedOnly).toBe(false);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a valid filter set', async () => {
    const dto = plainToInstance(ExportCommissionDto, {
      sellerId: '123e4567-e89b-42d3-a456-426614174000',
      status: 'PENDING',
      dateFrom: '2026-05-01',
      precision: 'paise',
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
