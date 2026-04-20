import { Prisma } from '@prisma/client';

export interface OrderRepository {
  // ── Master Order queries ───────────────────────────────────────────────

  findMasterOrders(
    where: Prisma.MasterOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<any[]>;

  countMasterOrders(where: Prisma.MasterOrderWhereInput): Promise<number>;

  findMasterOrderById(id: string): Promise<any | null>;

  findMasterOrderByIdWithDetails(id: string): Promise<any | null>;

  findMasterOrderByCustomer(
    orderNumber: string,
    customerId: string,
  ): Promise<any | null>;

  findCustomerOrders(
    customerId: string,
    skip: number,
    take: number,
  ): Promise<any[]>;

  countCustomerOrders(customerId: string): Promise<number>;

  updateMasterOrder(id: string, data: any): Promise<any>;

  // ── Sub-Order queries ──────────────────────────────────────────────────

  findSubOrderById(id: string): Promise<any | null>;

  findSubOrderByIdWithItems(id: string): Promise<any | null>;

  findSubOrderByIdWithMasterOrder(id: string): Promise<any | null>;

  /** Look up a sub-order by its courier tracking number. Used by the
   *  Shiprocket webhook to find the right sub-order to mark delivered. */
  findSubOrderByTrackingNumber(trackingNumber: string): Promise<any | null>;

  findSubOrderForSeller(id: string, sellerId: string): Promise<any | null>;

  findSubOrderForSellerBasic(
    id: string,
    sellerId: string,
  ): Promise<any | null>;

  findSubOrderForSellerWithDetails(
    id: string,
    sellerId: string,
  ): Promise<any | null>;

  findSellerSubOrders(
    where: Prisma.SubOrderWhereInput,
    skip: number,
    take: number,
  ): Promise<any[]>;

  countSellerSubOrders(where: Prisma.SubOrderWhereInput): Promise<number>;

  findSubOrdersByMasterOrder(
    masterOrderId: string,
  ): Promise<any[]>;

  updateSubOrder(id: string, data: any): Promise<any>;

  createSubOrder(data: any): Promise<any>;

  // ── Reassignment logs ──────────────────────────────────────────────────

  findReassignmentLogs(masterOrderId: string): Promise<any[]>;

  createReassignmentLog(data: any): Promise<any>;

  // ── Stock & reservation helpers ────────────────────────────────────────

  findSeller(id: string): Promise<any | null>;

  findSellerProductMapping(
    sellerId: string,
    productId: string,
    variantId: string | null,
  ): Promise<any | null>;

  findSellerProductMappingIds(
    productId: string,
    variantId: string | null,
    sellerIds: string[],
  ): Promise<string[]>;

  findStockReservations(
    orderId: string,
    sellerId: string,
  ): Promise<any[]>;

  releaseReservation(reservationId: string): Promise<void>;

  restoreStockFromConfirmedReservation(
    reservationId: string,
    mappingId: string,
    quantity: number,
  ): Promise<void>;

  releaseReservedStock(
    reservationId: string,
    mappingId: string,
    quantity: number,
  ): Promise<void>;

  createStockReservation(data: any): Promise<any>;

  incrementMappingReservedQty(mappingId: string, quantity: number): Promise<void>;

  // ── Product stock restore (for order rejection) ────────────────────────

  incrementVariantStock(variantId: string, quantity: number): Promise<void>;

  incrementProductStock(productId: string, quantity: number): Promise<void>;

  // ── Allocation log ─────────────────────────────────────────────────────

  createAllocationLog(data: any): Promise<void>;

  // ── Expired sub-orders (for timeout service) ───────────────────────────

  findExpiredSubOrders(now: Date): Promise<{ id: string; sellerId: string | null }[]>;

  // ── Transaction support ────────────────────────────────────────────────

  executeTransaction(fn: (tx: any) => Promise<void>): Promise<void>;
}

export const ORDER_REPOSITORY = Symbol('OrderRepository');
