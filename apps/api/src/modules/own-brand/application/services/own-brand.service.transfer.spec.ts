import { OwnBrandService } from './own-brand.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';

/**
 * Story 3.4 — Nova stock transfer-between-warehouses validation.
 *
 * Tests the service-layer guards (what gets rejected before any DB
 * write). The repository's atomic transaction is tested separately
 * by integration tests at the prisma layer — here we lock in the
 * shape contract: which payloads are 400 vs 404 vs forwarded to the
 * repo. Surprising bug class historically: TOCTOU between the
 * warehouse-exists check and the repo's insufficient-stock check, so
 * we explicitly assert the repo's "Insufficient stock" error is
 * surfaced as a 400 (not a 500).
 */
describe('OwnBrandService.transferStock', () => {
  function buildService(opts: {
    findWarehouseById?: jest.Mock;
    findProductById?: jest.Mock;
    transferStock?: jest.Mock;
  } = {}) {
    const repo = {
      findWarehouseById:
        opts.findWarehouseById ??
        jest.fn().mockImplementation((id: string) =>
          Promise.resolve({ id, code: `WH-${id}`, name: `Warehouse ${id}` }),
        ),
      findProductById:
        opts.findProductById ??
        jest.fn().mockResolvedValue({
          id: 'p-1',
          title: 'Sample',
          productSource: 'OWN_BRAND',
        }),
      transferStock:
        opts.transferStock ??
        jest.fn().mockResolvedValue({
          fromStock: { id: 's1', stockQty: 5 },
          toStock: { id: 's2', stockQty: 5 },
        }),
    } as any;

    const eventBus = { publish: jest.fn() } as any;
    const service = new OwnBrandService(repo, eventBus);
    return { service, repo };
  }

  const validArgs = {
    fromWarehouseId: 'wh-1',
    toWarehouseId: 'wh-2',
    productId: 'p-1',
    quantity: 5,
    reason: 'restocking',
    adminId: 'admin-1',
  };

  it('happy path: forwards normalised payload to repo', async () => {
    const { service, repo } = buildService();
    const result = await service.transferStock(validArgs);

    expect(repo.transferStock).toHaveBeenCalledWith({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      productId: 'p-1',
      variantId: null,
      quantity: 5,
      reason: 'restocking',
      adminId: 'admin-1',
    });
    expect(result.fromStock).toBeDefined();
    expect(result.toStock).toBeDefined();
  });

  it('rejects same source and destination warehouse', async () => {
    const { service, repo } = buildService();
    await expect(
      service.transferStock({ ...validArgs, toWarehouseId: 'wh-1' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('rejects non-positive quantity', async () => {
    const { service, repo } = buildService();
    await expect(
      service.transferStock({ ...validArgs, quantity: 0 }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    await expect(
      service.transferStock({ ...validArgs, quantity: -1 }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('rejects non-integer quantity', async () => {
    const { service, repo } = buildService();
    await expect(
      service.transferStock({ ...validArgs, quantity: 1.5 }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('rejects empty / whitespace reason', async () => {
    const { service, repo } = buildService();
    await expect(
      service.transferStock({ ...validArgs, reason: '' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    await expect(
      service.transferStock({ ...validArgs, reason: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestAppException);
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('404 when source warehouse not found', async () => {
    const { service, repo } = buildService({
      findWarehouseById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve(id === 'wh-2' ? { id } : null),
      ),
    });
    await expect(service.transferStock(validArgs)).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('404 when destination warehouse not found', async () => {
    const { service, repo } = buildService({
      findWarehouseById: jest.fn().mockImplementation((id: string) =>
        Promise.resolve(id === 'wh-1' ? { id } : null),
      ),
    });
    await expect(service.transferStock(validArgs)).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('404 when product not found', async () => {
    const { service, repo } = buildService({
      findProductById: jest.fn().mockResolvedValue(null),
    });
    await expect(service.transferStock(validArgs)).rejects.toBeInstanceOf(
      NotFoundAppException,
    );
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('400 when product is not OWN_BRAND', async () => {
    const { service, repo } = buildService({
      findProductById: jest.fn().mockResolvedValue({
        id: 'p-1',
        productSource: 'SELLER',
      }),
    });
    await expect(service.transferStock(validArgs)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(repo.transferStock).not.toHaveBeenCalled();
  });

  it('surfaces repo "Insufficient stock" as 400, not 500', async () => {
    const { service } = buildService({
      transferStock: jest
        .fn()
        .mockRejectedValue(
          new Error('Insufficient stock — available 2, requested 5'),
        ),
    });
    await expect(service.transferStock(validArgs)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('surfaces repo "No stock row" as 400, not 500', async () => {
    const { service } = buildService({
      transferStock: jest
        .fn()
        .mockRejectedValue(new Error('No stock row at source warehouse wh-1')),
    });
    await expect(service.transferStock(validArgs)).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('lets unexpected repo errors propagate as 500-equivalent', async () => {
    const boom = new Error('DB connection lost');
    const { service } = buildService({
      transferStock: jest.fn().mockRejectedValue(boom),
    });
    await expect(service.transferStock(validArgs)).rejects.toBe(boom);
  });
});
