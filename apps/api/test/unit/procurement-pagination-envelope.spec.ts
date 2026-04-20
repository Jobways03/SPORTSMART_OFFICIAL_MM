import 'reflect-metadata';
import { AdminProcurementController } from '../../src/modules/franchise/presentation/controllers/admin-procurement.controller';
import { FranchiseProcurementController } from '../../src/modules/franchise/presentation/controllers/franchise-procurement.controller';

/**
 * Regression test for procurement list response shape.
 *
 * Before: both /admin/procurement and /franchise/procurement returned
 * `{ requests, total }` — a flat shape — while every other list
 * endpoint in this codebase (admin-products, admin-categories,
 * storefront-products, …) returns the pagination envelope
 * `{ requests, pagination: { page, limit, total, totalPages } }`.
 *
 * The affiliate and franchise dashboards both read
 * `data.pagination.total` and crashed on first render:
 *   TypeError: Cannot read properties of undefined (reading 'total')
 *
 * After: both controllers wrap the repo response in the same envelope
 * used everywhere else. This test pins both shapes.
 */

describe('AdminProcurementController.listAllRequests — response envelope', () => {
  it('wraps requests in { requests, pagination: { page, limit, total, totalPages } }', async () => {
    const service: any = {
      listAllRequests: jest.fn().mockResolvedValue({
        requests: [{ id: 'r1' }, { id: 'r2' }],
        total: 47,
      }),
    };
    const ctrl = new AdminProcurementController(service);

    const res = await ctrl.listAllRequests('3', '20');

    expect(service.listAllRequests).toHaveBeenCalledWith(3, 20, undefined, undefined, undefined);
    expect(res).toMatchObject({
      success: true,
      data: {
        requests: [{ id: 'r1' }, { id: 'r2' }],
        pagination: {
          page: 3,
          limit: 20,
          total: 47,
          totalPages: 3, // ceil(47 / 20)
        },
      },
    });
  });

  it('defaults page=1 and limit=20 when query params are missing', async () => {
    const service: any = {
      listAllRequests: jest.fn().mockResolvedValue({ requests: [], total: 0 }),
    };
    const ctrl = new AdminProcurementController(service);

    const res = await ctrl.listAllRequests();

    expect(service.listAllRequests).toHaveBeenCalledWith(1, 20, undefined, undefined, undefined);
    expect(res.data.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });
});

describe('FranchiseProcurementController.listMyRequests — response envelope', () => {
  it('wraps requests in the same pagination envelope', async () => {
    const service: any = {
      getMyRequests: jest.fn().mockResolvedValue({
        requests: [{ id: 'r1' }],
        total: 1,
      }),
    };
    const ctrl = new FranchiseProcurementController(service);

    const req: any = { franchiseId: 'fr-1' };
    const res = await ctrl.listMyRequests(req, '1', '10');

    expect(service.getMyRequests).toHaveBeenCalledWith('fr-1', 1, 10, undefined);
    expect(res).toMatchObject({
      success: true,
      data: {
        requests: [{ id: 'r1' }],
        pagination: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        },
      },
    });
  });
});
