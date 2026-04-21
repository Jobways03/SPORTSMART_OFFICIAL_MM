import 'reflect-metadata';
import { AdminProcurementController } from '../../src/modules/franchise/presentation/controllers/admin-procurement.controller';
import { FranchiseProcurementController } from '../../src/modules/franchise/presentation/controllers/franchise-procurement.controller';
import { AdminFranchiseSettlementsController } from '../../src/modules/franchise/presentation/controllers/admin-franchise-settlements.controller';
import { AdminFranchiseCatalogController } from '../../src/modules/franchise/presentation/controllers/admin-franchise-catalog.controller';

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

describe('AdminFranchiseSettlementsController.listSettlements — response envelope', () => {
  it('wraps settlements in the pagination envelope so dashboard KPIs resolve', async () => {
    // The affiliate/franchise-admin dashboard reads
    // data.pagination.total for its "Pending Settlements" tile.
    // Without this envelope the tile stayed at "--".
    const service: any = {
      listSettlements: jest.fn().mockResolvedValue({
        settlements: [{ id: 's1' }, { id: 's2' }],
        total: 12,
      }),
    };
    const ctrl = new AdminFranchiseSettlementsController(service);

    const res = await ctrl.listSettlements('1', '1', undefined, undefined, 'PENDING');

    expect(service.listSettlements).toHaveBeenCalledWith({
      page: 1,
      limit: 1,
      cycleId: undefined,
      franchiseId: undefined,
      status: 'PENDING',
    });
    expect(res).toMatchObject({
      success: true,
      data: {
        settlements: [{ id: 's1' }, { id: 's2' }],
        pagination: {
          page: 1,
          limit: 1,
          total: 12,
          totalPages: 12,
        },
      },
    });
  });
});

describe('AdminFranchiseCatalogController.listAllMappings — response envelope', () => {
  it('wraps mappings in the pagination envelope so the admin pager can render', async () => {
    // The franchise-admin catalog page uses pagination.totalPages to
    // decide whether to render the Prev / Next controls. The bare
    // { mappings, total } shape the repo returned made that check
    // always false, so the pager was invisible even when rows
    // spanned multiple pages.
    const repo: any = {
      findAllPaginated: jest.fn().mockResolvedValue({
        mappings: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
        total: 45,
      }),
    };
    const ctrl = new AdminFranchiseCatalogController(repo);

    const res = await ctrl.listAllMappings('2', '20');

    expect(repo.findAllPaginated).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      franchiseId: undefined,
      approvalStatus: undefined,
      search: undefined,
    });
    expect(res).toMatchObject({
      success: true,
      data: {
        mappings: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
        pagination: {
          page: 2,
          limit: 20,
          total: 45,
          totalPages: 3, // ceil(45 / 20)
        },
      },
    });
  });
});
