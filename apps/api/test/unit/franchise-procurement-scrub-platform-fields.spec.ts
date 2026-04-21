import 'reflect-metadata';
import { FranchiseProcurementController } from '../../src/modules/franchise/presentation/controllers/franchise-procurement.controller';

/**
 * Regression test for the franchise-side procurement API scrub.
 *
 * Before: the controller returned the full ProcurementRequest object,
 * including the platform's internal cost breakdown
 * (landedUnitCost, procurementFeePerUnit on each item, plus
 * totalApprovedAmount, procurementFeeAmount, procurementFeeRate on
 * the request). The franchise UI had already been updated to hide
 * these columns, but a curl'd response still leaked the margin.
 *
 * After: a scrubPlatformBreakdown helper in the controller strips
 * those fields before return on every endpoint that goes out to a
 * franchise (create, list, detail, submit, cancel, receive). The
 * admin-procurement controller is a separate class and deliberately
 * keeps the full breakdown.
 */

describe('FranchiseProcurementController — platform-breakdown scrub', () => {
  const sampleRequest = {
    id: 'req-1',
    franchiseId: 'fr-A',
    status: 'DISPATCHED',
    // Request-level aggregates: franchise-facing kept, admin-only scrubbed.
    totalRequestedAmount: '0.00',
    totalApprovedAmount: '100.00',
    procurementFeeAmount: '5.00',
    procurementFeeRate: '5.00',
    finalPayableAmount: '105.00',
    items: [
      {
        id: 'it-1',
        productTitle: 'Gloves',
        requestedQty: 10,
        approvedQty: 10,
        landedUnitCost: '10.00',
        procurementFeePerUnit: '0.50',
        finalUnitCostToFranchise: '10.50',
        status: 'APPROVED',
      },
    ],
  };

  const buildCtrl = (resolve: any) => {
    const service: any = {
      createRequest: jest.fn().mockResolvedValue(resolve),
      getMyRequests: jest.fn().mockResolvedValue({
        requests: [resolve],
        total: 1,
      }),
      getRequestDetail: jest.fn().mockResolvedValue(resolve),
      submitRequest: jest.fn().mockResolvedValue(resolve),
      cancelRequest: jest.fn().mockResolvedValue(resolve),
      confirmReceipt: jest.fn().mockResolvedValue(resolve),
    };
    return { ctrl: new FranchiseProcurementController(service), service };
  };

  const req = { franchiseId: 'fr-A' } as any;

  const assertScrubbed = (data: any) => {
    // Request-level: admin-internal aggregates must be absent.
    expect(data).not.toHaveProperty('totalApprovedAmount');
    expect(data).not.toHaveProperty('procurementFeeAmount');
    expect(data).not.toHaveProperty('procurementFeeRate');
    // Request-level: franchise-facing totals must be preserved.
    expect(data.finalPayableAmount).toBe('105.00');
    expect(data.totalRequestedAmount).toBe('0.00');
    // Item-level: per-unit breakdown must be absent.
    expect(data.items[0]).not.toHaveProperty('landedUnitCost');
    expect(data.items[0]).not.toHaveProperty('procurementFeePerUnit');
    // Item-level: rolled-up unit cost kept.
    expect(data.items[0].finalUnitCostToFranchise).toBe('10.50');
    // Item-level: qty / status / title all untouched.
    expect(data.items[0].approvedQty).toBe(10);
    expect(data.items[0].status).toBe('APPROVED');
  };

  it('scrubs createRequest response', async () => {
    const { ctrl } = buildCtrl(sampleRequest);
    const res = await ctrl.createRequest(req, { items: [] } as any);
    assertScrubbed(res.data);
  });

  it('scrubs listMyRequests response (each row)', async () => {
    const { ctrl } = buildCtrl(sampleRequest);
    const res = await ctrl.listMyRequests(req);
    const d: any = res.data;
    expect(Array.isArray(d.requests)).toBe(true);
    assertScrubbed(d.requests[0]);
    // Pagination envelope must still be present (regression: earlier
    // refactors broke this).
    expect(d.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('scrubs getRequestDetail response', async () => {
    const { ctrl } = buildCtrl(sampleRequest);
    const res = await ctrl.getRequestDetail(req, 'req-1');
    assertScrubbed(res.data);
  });

  it('scrubs submitRequest response', async () => {
    const { ctrl } = buildCtrl(sampleRequest);
    const res = await ctrl.submitRequest(req, 'req-1');
    assertScrubbed(res.data);
  });

  it('scrubs cancelRequest response', async () => {
    const { ctrl } = buildCtrl(sampleRequest);
    const res = await ctrl.cancelRequest(req, 'req-1', { reason: 'x' } as any);
    assertScrubbed(res.data);
  });

  it('scrubs confirmReceipt response', async () => {
    const { ctrl } = buildCtrl(sampleRequest);
    const res = await ctrl.confirmReceipt(req, 'req-1', { items: [] } as any);
    assertScrubbed(res.data);
  });
});
