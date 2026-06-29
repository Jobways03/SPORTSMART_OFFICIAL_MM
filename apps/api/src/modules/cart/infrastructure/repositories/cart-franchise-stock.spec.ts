// Regression: cart availability must count franchise stock.
//
// The cart's available-stock was computed from seller_product_mappings only,
// so a franchise-tier product (stock in franchise_stock) read as 0 and could
// not be added to cart ("Insufficient stock. Available: 0") even though the
// franchise had it in stock. getAggregatedStock now adds franchise
// availability on top of the seller total. These tests assert the union so a
// future change that drops franchise stock from the cart fails here.

import { PrismaCartRepository } from './prisma-cart.repository';

function makeRepo(opts: {
  sellerStockQty: number;
  sellerReservedQty: number;
  franchiseAvailable: number;
}) {
  const prisma: any = {
    sellerProductMapping: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { stockQty: opts.sellerStockQty, reservedQty: opts.sellerReservedQty },
      }),
    },
    // franchiseAvailable() runs a raw SUM(available_qty) query.
    $queryRaw: jest.fn().mockResolvedValue([{ available: opts.franchiseAvailable }]),
  };
  return { repo: new PrismaCartRepository(prisma), prisma };
}

describe('PrismaCartRepository.getAggregatedStock — franchise + seller union', () => {
  it('counts franchise stock when there is no seller stock (the reported bug)', async () => {
    const { repo, prisma } = makeRepo({
      sellerStockQty: 0,
      sellerReservedQty: 0,
      franchiseAvailable: 8,
    });
    await expect(repo.getAggregatedStock('prod-1', 'variant-youth')).resolves.toBe(8);
    // The franchise raw query was actually consulted.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('adds seller + franchise availability together', async () => {
    const { repo } = makeRepo({
      sellerStockQty: 5,
      sellerReservedQty: 2, // seller available = 3
      franchiseAvailable: 8,
    });
    await expect(repo.getAggregatedStock('prod-1', 'variant-men')).resolves.toBe(11);
  });

  it('returns 0 only when BOTH sources are empty', async () => {
    const { repo } = makeRepo({
      sellerStockQty: 0,
      sellerReservedQty: 0,
      franchiseAvailable: 0,
    });
    await expect(repo.getAggregatedStock('prod-1', 'variant-x')).resolves.toBe(0);
  });

  it('does not let a seller over-reservation go negative before adding franchise', async () => {
    const { repo } = makeRepo({
      sellerStockQty: 2,
      sellerReservedQty: 5, // seller available clamps to 0, not -3
      franchiseAvailable: 4,
    });
    await expect(repo.getAggregatedStock('prod-1', 'variant-x')).resolves.toBe(4);
  });
});
