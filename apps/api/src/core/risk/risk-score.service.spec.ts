import { RiskScoreService } from './risk-score.service';

describe('RiskScoreService.getManyOrZero — batched lookup', () => {
  function make(rows: Array<{ resourceId: string; score: number; tier: string }>) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { riskScore: { findMany } } as any;
    const calculator = {} as any;
    return { svc: new RiskScoreService(prisma, calculator), findMany };
  }

  it('issues a single findMany and maps rows by resourceId', async () => {
    const { svc, findMany } = make([
      { resourceId: 'a', score: 70, tier: 'HIGH' },
      { resourceId: 'b', score: 30, tier: 'MEDIUM' },
    ]);
    const map = await svc.getManyOrZero('dispute', ['a', 'b', 'c']);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { resourceType: 'dispute', resourceId: { in: ['a', 'b', 'c'] } },
      select: { resourceId: true, score: true, tier: true },
    });
    expect(map.get('a')).toEqual({ score: 70, tier: 'HIGH' });
    expect(map.get('b')).toEqual({ score: 30, tier: 'MEDIUM' });
  });

  it('omits rows with no score (caller defaults them to LOW/0)', async () => {
    const { svc } = make([{ resourceId: 'a', score: 70, tier: 'HIGH' }]);
    const map = await svc.getManyOrZero('dispute', ['a', 'c']);
    expect(map.has('c')).toBe(false);
  });

  it('short-circuits to an empty map without hitting the DB for an empty id list', async () => {
    const { svc, findMany } = make([]);
    const map = await svc.getManyOrZero('dispute', []);
    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
