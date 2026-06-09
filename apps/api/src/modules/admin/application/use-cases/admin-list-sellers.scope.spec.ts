import { AdminListSellersUseCase } from './admin-list-sellers.use-case';

/**
 * Phase 38 (admin enforcement) — the list query must be hard-bounded to the
 * admin's authoritative seller-type scope. The optional client `sellerType`
 * may only narrow within that scope; it can never widen it.
 */
describe('AdminListSellersUseCase — seller-type scope', () => {
  function make() {
    const listSellers = jest.fn(async () => [[], 0] as [any[], number]);
    const useCase = new AdminListSellersUseCase({ listSellers } as any);
    return { useCase, listSellers };
  }

  const whereOf = (listSellers: jest.Mock) =>
    (listSellers.mock.calls[0]![0] as any).where;

  it('hard-bounds to the allowed types when scoped with no client filter', async () => {
    const { useCase, listSellers } = make();
    await useCase.execute({ page: 1, limit: 20, allowedSellerTypes: ['D2C'] });
    expect(whereOf(listSellers).sellerType).toEqual({ in: ['D2C'] });
  });

  it('uses the single client type when it is within scope', async () => {
    const { useCase, listSellers } = make();
    await useCase.execute({
      page: 1,
      limit: 20,
      sellerType: 'D2C',
      allowedSellerTypes: ['D2C'],
    });
    expect(whereOf(listSellers).sellerType).toBe('D2C');
  });

  it('ignores an out-of-scope client type and falls back to the scope set', async () => {
    // The controller 403s this case; the use-case stays defensive and never widens.
    const { useCase, listSellers } = make();
    await useCase.execute({
      page: 1,
      limit: 20,
      sellerType: 'RETAIL',
      allowedSellerTypes: ['D2C'],
    });
    expect(whereOf(listSellers).sellerType).toEqual({ in: ['D2C'] });
  });

  it('honours the optional client filter when unscoped (legacy behaviour)', async () => {
    const { useCase, listSellers } = make();
    await useCase.execute({ page: 1, limit: 20, sellerType: 'RETAIL' });
    expect(whereOf(listSellers).sellerType).toBe('RETAIL');
  });

  it('applies no seller-type filter when unscoped and unfiltered', async () => {
    const { useCase, listSellers } = make();
    await useCase.execute({ page: 1, limit: 20 });
    expect(whereOf(listSellers).sellerType).toBeUndefined();
  });

  it('bounds to both types for a both-scoped (super) admin', async () => {
    const { useCase, listSellers } = make();
    await useCase.execute({
      page: 1,
      limit: 20,
      allowedSellerTypes: ['D2C', 'RETAIL'],
    });
    expect(whereOf(listSellers).sellerType).toEqual({ in: ['D2C', 'RETAIL'] });
  });
});
