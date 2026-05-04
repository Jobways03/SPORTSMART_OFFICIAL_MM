import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface SalesSummary {
  grossRevenue: number;
  netRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  byDay: Array<{ date: string; revenue: number; orders: number }>;
}

export interface OrderStatusMix {
  status: string;
  count: number;
  amount: number;
}

export interface ProductPerformance {
  productId: string;
  title: string;
  unitsSold: number;
  revenue: number;
}

export interface CustomerAnalytics {
  totalCustomers: number;
  newInPeriod: number;
  returningInPeriod: number;
  averageLifetimeOrders: number;
}

export interface ConversionFunnel {
  cartCreated: number;
  checkoutInitiated: number;
  ordersPlaced: number;
  ordersPaid: number;
  cartToCheckoutRate: number;
  checkoutToPaidRate: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Sales / Orders / Products (Phase 24) ────────────────────────

  async getSalesSummary(range: DateRange): Promise<SalesSummary> {
    const orders = await this.prisma.masterOrder.findMany({
      where: {
        createdAt: { gte: range.start, lt: range.end },
        orderStatus: { not: 'CANCELLED' },
      },
      select: {
        totalAmount: true,
        discountAmount: true,
        createdAt: true,
      },
    });

    const grossRevenue = orders.reduce((s, o) => s + Number(o.totalAmount ?? 0), 0);
    const totalDiscount = orders.reduce(
      (s, o) => s + Number(o.discountAmount ?? 0),
      0,
    );
    const netRevenue = grossRevenue - totalDiscount;
    const orderCount = orders.length;
    const averageOrderValue = orderCount > 0 ? grossRevenue / orderCount : 0;

    // Bucket by day (YYYY-MM-DD).
    const byDayMap = new Map<string, { revenue: number; orders: number }>();
    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10);
      const e = byDayMap.get(day) ?? { revenue: 0, orders: 0 };
      e.revenue += Number(o.totalAmount ?? 0);
      e.orders += 1;
      byDayMap.set(day, e);
    }
    const byDay = Array.from(byDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    return { grossRevenue, netRevenue, orderCount, averageOrderValue, byDay };
  }

  async getOrderStatusMix(range: DateRange): Promise<OrderStatusMix[]> {
    const grouped = await this.prisma.masterOrder.groupBy({
      by: ['orderStatus'],
      where: { createdAt: { gte: range.start, lt: range.end } },
      _count: { _all: true },
      _sum: { totalAmount: true },
    });
    return grouped.map((g) => ({
      status: g.orderStatus,
      count: g._count._all,
      amount: Number(g._sum.totalAmount ?? 0),
    }));
  }

  async getTopProducts(range: DateRange, limit = 10): Promise<ProductPerformance[]> {
    // Group order_items by productId in the period.
    const items = await this.prisma.$queryRaw<Array<{
      product_id: string;
      title: string;
      units_sold: bigint;
      revenue: number;
    }>>(Prisma.sql`
      SELECT
        oi.product_id::text                   AS product_id,
        MAX(oi.product_title)                  AS title,
        SUM(oi.quantity)                       AS units_sold,
        SUM(oi.total_price)                    AS revenue
      FROM order_items oi
      JOIN sub_orders so ON so.id = oi.sub_order_id
      JOIN master_orders mo ON mo.id = so.master_order_id
      WHERE mo.created_at >= ${range.start}
        AND mo.created_at <  ${range.end}
        AND mo.order_status <> 'CANCELLED'
      GROUP BY oi.product_id
      ORDER BY revenue DESC
      LIMIT ${limit}
    `);

    return items.map((r) => ({
      productId: r.product_id,
      title: r.title ?? '(unknown)',
      unitsSold: Number(r.units_sold ?? 0),
      revenue: Number(r.revenue ?? 0),
    }));
  }

  async getBottomProducts(range: DateRange, limit = 10): Promise<ProductPerformance[]> {
    const items = await this.prisma.$queryRaw<Array<{
      product_id: string;
      title: string;
      units_sold: bigint;
      revenue: number;
    }>>(Prisma.sql`
      SELECT
        oi.product_id::text                   AS product_id,
        MAX(oi.product_title)                  AS title,
        SUM(oi.quantity)                       AS units_sold,
        SUM(oi.total_price)                    AS revenue
      FROM order_items oi
      JOIN sub_orders so ON so.id = oi.sub_order_id
      JOIN master_orders mo ON mo.id = so.master_order_id
      WHERE mo.created_at >= ${range.start}
        AND mo.created_at <  ${range.end}
        AND mo.order_status <> 'CANCELLED'
      GROUP BY oi.product_id
      HAVING SUM(oi.quantity) > 0
      ORDER BY revenue ASC
      LIMIT ${limit}
    `);

    return items.map((r) => ({
      productId: r.product_id,
      title: r.title ?? '(unknown)',
      unitsSold: Number(r.units_sold ?? 0),
      revenue: Number(r.revenue ?? 0),
    }));
  }

  // ── Customer / Search / Conversion (Phase 25) ───────────────────

  async getCustomerAnalytics(range: DateRange): Promise<CustomerAnalytics> {
    const totalCustomers = await this.prisma.user.count();
    const newInPeriod = await this.prisma.user.count({
      where: { createdAt: { gte: range.start, lt: range.end } },
    });
    // Returning = customers placing orders in the period whose first
    // order was BEFORE the period.
    const returning = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT customer_id) AS count
      FROM master_orders mo
      WHERE mo.created_at >= ${range.start}
        AND mo.created_at <  ${range.end}
        AND EXISTS (
          SELECT 1 FROM master_orders mo2
          WHERE mo2.customer_id = mo.customer_id
            AND mo2.created_at < ${range.start}
        )
    `);
    const returningInPeriod = Number(returning[0]?.count ?? 0);

    const ordersPerCustomer = await this.prisma.$queryRaw<Array<{ avg: number }>>(Prisma.sql`
      SELECT COALESCE(AVG(c), 0) AS avg
      FROM (
        SELECT customer_id, COUNT(*) AS c
        FROM master_orders
        WHERE order_status <> 'CANCELLED'
        GROUP BY customer_id
      ) AS sub
    `);
    const averageLifetimeOrders = Number(ordersPerCustomer[0]?.avg ?? 0);

    return {
      totalCustomers,
      newInPeriod,
      returningInPeriod,
      averageLifetimeOrders,
    };
  }

  async getConversionFunnel(range: DateRange): Promise<ConversionFunnel> {
    // Funnel signals:
    //   cartCreated       → Cart row created (user added a first item)
    //   checkoutInitiated → MasterOrder row created (user reached checkout
    //                       and submitted address+payment selection)
    //   ordersPlaced      → MasterOrder confirmed (not CANCELLED, not
    //                       still PENDING_PAYMENT — they didn't abandon)
    //   ordersPaid        → paymentStatus=PAID
    //
    // The earlier `× 1.5` placeholder for checkoutInitiated is replaced
    // with the real count of MasterOrders created in the window — the
    // platform does treat MasterOrder creation as the "user reached
    // checkout" milestone.
    const cartCreated = await this.prisma.cart.count({
      where: { createdAt: { gte: range.start, lt: range.end } },
    });

    const checkoutInitiated = await this.prisma.masterOrder.count({
      where: { createdAt: { gte: range.start, lt: range.end } },
    });

    const ordersPlaced = await this.prisma.masterOrder.count({
      where: {
        createdAt: { gte: range.start, lt: range.end },
        orderStatus: { notIn: ['CANCELLED', 'PENDING_PAYMENT'] },
      },
    });

    const ordersPaid = await this.prisma.masterOrder.count({
      where: {
        createdAt: { gte: range.start, lt: range.end },
        paymentStatus: 'PAID',
      },
    });

    return {
      cartCreated,
      checkoutInitiated,
      ordersPlaced,
      ordersPaid,
      cartToCheckoutRate:
        cartCreated > 0 ? checkoutInitiated / cartCreated : 0,
      checkoutToPaidRate:
        checkoutInitiated > 0 ? ordersPaid / checkoutInitiated : 0,
    };
  }

  // ── Compare-period helper ────────────────────────────────────────

  /**
   * Returns sales summaries for the current period and the immediately
   * preceding period of equal length, plus per-metric delta percentages.
   * Used by the dashboard "vs last period" header strip.
   */
  async getSalesCompare(args: { start: Date; end: Date }): Promise<{
    current: SalesSummary;
    previous: SalesSummary;
    deltas: {
      grossRevenuePct: number | null;
      netRevenuePct: number | null;
      orderCountPct: number | null;
      averageOrderValuePct: number | null;
    };
  }> {
    const lengthMs = args.end.getTime() - args.start.getTime();
    const prevEnd = args.start;
    const prevStart = new Date(args.start.getTime() - lengthMs);

    const [current, previous] = await Promise.all([
      this.getSalesSummary({ start: args.start, end: args.end }),
      this.getSalesSummary({ start: prevStart, end: prevEnd }),
    ]);

    const pct = (cur: number, prev: number): number | null => {
      if (prev === 0) return cur === 0 ? 0 : null; // null = "from zero"
      return ((cur - prev) / prev) * 100;
    };

    return {
      current,
      previous,
      deltas: {
        grossRevenuePct: pct(current.grossRevenue, previous.grossRevenue),
        netRevenuePct: pct(current.netRevenue, previous.netRevenue),
        orderCountPct: pct(current.orderCount, previous.orderCount),
        averageOrderValuePct: pct(
          current.averageOrderValue,
          previous.averageOrderValue,
        ),
      },
    };
  }
}
