// Phase 72 (2026-05-22) — Phase 71 risk audit Gap #12.

import { RiskRuleConfigService } from './risk-rule-config.service';

function makeSvc(rows: any[] = []) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const upsert = jest.fn().mockImplementation(async ({ create, update }: any) => ({
    ...update,
    ...create,
  }));
  const prisma: any = {
    orderRiskRuleConfig: { findMany, upsert },
  };
  return { svc: new RiskRuleConfigService(prisma), prisma };
}

describe('RiskRuleConfigService', () => {
  it('returns DB row when present (cached on second call)', async () => {
    const { svc, prisma } = makeSvc([
      {
        reasonCode: 'HIGH_VALUE',
        scoreDelta: 25,
        config: { valueRupees: 5_000 },
        enabled: true,
        maskAmounts: false,
      },
    ]);
    const a = await svc.get('HIGH_VALUE');
    const b = await svc.get('HIGH_VALUE');
    expect(a.scoreDelta).toBe(25);
    expect(a.config).toEqual({ valueRupees: 5_000 });
    expect(b.scoreDelta).toBe(25);
    expect(prisma.orderRiskRuleConfig.findMany).toHaveBeenCalledTimes(1);
  });

  it('falls back to in-code default when no DB row exists', async () => {
    const { svc } = makeSvc([]);
    const r = await svc.get('VERY_HIGH_VALUE');
    expect(r.scoreDelta).toBe(20);
    expect(r.config.valueRupees).toBe(25_000);
    expect(r.enabled).toBe(true);
  });

  it('falls back to defaults when DB read throws', async () => {
    const findMany = jest.fn().mockRejectedValue(new Error('DB down'));
    const prisma: any = { orderRiskRuleConfig: { findMany, upsert: jest.fn() } };
    const svc = new RiskRuleConfigService(prisma);
    const r = await svc.get('BULK_ORDER');
    expect(r.scoreDelta).toBe(5);
    expect(r.config.itemThreshold).toBe(10);
  });

  it('list() merges DB rows + defaults with usingDefault flag', async () => {
    const { svc } = makeSvc([
      {
        reasonCode: 'HIGH_VALUE',
        scoreDelta: 25,
        config: { valueRupees: 5_000 },
        enabled: true,
        maskAmounts: true,
      },
    ]);
    const list = await svc.list();
    const high = list.find((r) => r.code === 'HIGH_VALUE')!;
    expect(high.usingDefault).toBe(false);
    expect(high.scoreDelta).toBe(25);
    expect(high.maskAmounts).toBe(true);

    const bulk = list.find((r) => r.code === 'BULK_ORDER')!;
    expect(bulk.usingDefault).toBe(true);
    expect(bulk.scoreDelta).toBe(5);
  });

  it('upsert writes row + invalidates cache', async () => {
    const { svc, prisma } = makeSvc([
      {
        reasonCode: 'HIGH_VALUE',
        scoreDelta: 10,
        config: { valueRupees: 10_000 },
        enabled: true,
        maskAmounts: false,
      },
    ]);
    // Warm cache
    await svc.get('HIGH_VALUE');
    expect(prisma.orderRiskRuleConfig.findMany).toHaveBeenCalledTimes(1);

    await svc.upsert(
      'HIGH_VALUE',
      { scoreDelta: 30, config: { valueRupees: 4_000 } },
      'admin-1',
    );
    expect(prisma.orderRiskRuleConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reasonCode: 'HIGH_VALUE' },
        update: expect.objectContaining({
          scoreDelta: 30,
          config: { valueRupees: 4_000 },
          updatedBy: 'admin-1',
        }),
      }),
    );

    // Next read re-loads from DB.
    await svc.get('HIGH_VALUE');
    expect(prisma.orderRiskRuleConfig.findMany).toHaveBeenCalledTimes(2);
  });

  it('rejects unknown rule codes', async () => {
    const { svc } = makeSvc();
    await expect(
      svc.upsert('NOT_A_RULE' as any, { scoreDelta: 1 }, 'admin-1'),
    ).rejects.toThrow(/Unknown rule code/);
  });

  it('disabled rules are returned via get()', async () => {
    const { svc } = makeSvc([
      {
        reasonCode: 'VELOCITY',
        scoreDelta: 10,
        config: { windowMinutes: 60, threshold: 3 },
        enabled: false,
        maskAmounts: false,
      },
    ]);
    const r = await svc.get('VELOCITY');
    expect(r.enabled).toBe(false);
  });
});
