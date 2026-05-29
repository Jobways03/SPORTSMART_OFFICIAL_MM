// Phase 71 (2026-05-22) — Phase 70 risk-scoring audit Gap #3.
//
// Event handler that scores orders at placement. Pre-Phase-71 the
// only scoring triggers were lazy; this handler closes that gap.

import { OrderRiskScoringHandler } from './order-risk-scoring.handler';

function makeHandler(scoreOrder: jest.Mock) {
  const riskScoring: any = { scoreOrder };
  return new OrderRiskScoringHandler(riskScoring);
}

describe('OrderRiskScoringHandler', () => {
  it('calls scoreOrder with the order id from the event', async () => {
    const scoreOrder = jest.fn().mockResolvedValue({
      score: 5,
      band: 'YELLOW',
      reasons: ['First-time customer'],
      reasonRows: [],
    });
    const handler = makeHandler(scoreOrder);
    await handler.handleOrderCreated({
      eventName: 'orders.master.created',
      aggregate: 'MasterOrder',
      aggregateId: 'mo-123',
      occurredAt: new Date(),
      payload: {},
    });
    expect(scoreOrder).toHaveBeenCalledWith('mo-123');
  });

  it('swallows scoring errors (best-effort; never blocks placement)', async () => {
    const scoreOrder = jest.fn().mockRejectedValue(new Error('db down'));
    const handler = makeHandler(scoreOrder);
    await expect(
      handler.handleOrderCreated({
        eventName: 'orders.master.created',
        aggregate: 'MasterOrder',
        aggregateId: 'mo-err',
        occurredAt: new Date(),
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('no-ops when aggregateId is missing', async () => {
    const scoreOrder = jest.fn();
    const handler = makeHandler(scoreOrder);
    await handler.handleOrderCreated({
      eventName: 'orders.master.created',
      aggregate: 'MasterOrder',
      aggregateId: '',
      occurredAt: new Date(),
      payload: {},
    } as any);
    expect(scoreOrder).not.toHaveBeenCalled();
  });
});
