import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { AnalyticsService, DateRange } from '../../application/services/analytics.service';

function parseRange(start?: string, end?: string): DateRange {
  if (!start || !end) {
    // Default: last 30 days.
    const e = new Date();
    const s = new Date(e);
    s.setDate(s.getDate() - 30);
    return { start: s, end: e };
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new BadRequestAppException('Invalid start/end date');
  }
  if (endDate <= startDate) {
    throw new BadRequestAppException('end must be after start');
  }
  return { start: startDate, end: endDate };
}

@ApiTags('Admin Analytics')
@Controller('admin/analytics')
@UseGuards(AdminAuthGuard)
export class AdminAnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('sales')
  async sales(@Query('start') start?: string, @Query('end') end?: string) {
    const data = await this.service.getSalesSummary(parseRange(start, end));
    return { success: true, message: 'Sales summary', data };
  }

  @Get('orders/status-mix')
  async orderStatusMix(@Query('start') start?: string, @Query('end') end?: string) {
    const data = await this.service.getOrderStatusMix(parseRange(start, end));
    return { success: true, message: 'Order status mix', data };
  }

  @Get('products/top')
  async topProducts(
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.getTopProducts(
      parseRange(start, end),
      parseInt(limit || '10', 10) || 10,
    );
    return { success: true, message: 'Top products', data };
  }

  @Get('products/bottom')
  async bottomProducts(
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.getBottomProducts(
      parseRange(start, end),
      parseInt(limit || '10', 10) || 10,
    );
    return { success: true, message: 'Bottom products', data };
  }

  @Get('customers')
  async customers(@Query('start') start?: string, @Query('end') end?: string) {
    const data = await this.service.getCustomerAnalytics(parseRange(start, end));
    return { success: true, message: 'Customer analytics', data };
  }

  @Get('conversion')
  async conversion(@Query('start') start?: string, @Query('end') end?: string) {
    const data = await this.service.getConversionFunnel(parseRange(start, end));
    return { success: true, message: 'Conversion funnel', data };
  }

  @Get('sales/compare')
  async compare(@Query('start') start?: string, @Query('end') end?: string) {
    const range = parseRange(start, end);
    const data = await this.service.getSalesCompare(range);
    return { success: true, message: 'Sales comparison', data };
  }

  // ── CSV exports ──────────────────────────────────────────────────

  @Get('export/:report.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Param('report') report: string,
    @Query('start') start: string,
    @Query('end') end: string,
    @Res() res: Response,
  ) {
    const range = parseRange(start, end);
    let csv = '';
    let filename = '';

    switch (report) {
      case 'sales-daily': {
        const data = await this.service.getSalesSummary(range);
        csv =
          'date,revenue,orders\n' +
          data.byDay
            .map((d) => `${d.date},${d.revenue.toFixed(2)},${d.orders}`)
            .join('\n');
        filename = `sales-daily_${dateOnly(range.start)}_${dateOnly(range.end)}.csv`;
        break;
      }
      case 'top-products': {
        const data = await this.service.getTopProducts(range, 100);
        csv =
          'product_id,title,units_sold,revenue\n' +
          data
            .map(
              (p) =>
                `${p.productId},"${escapeCsv(p.title)}",${p.unitsSold},${p.revenue.toFixed(2)}`,
            )
            .join('\n');
        filename = `top-products_${dateOnly(range.start)}_${dateOnly(range.end)}.csv`;
        break;
      }
      case 'bottom-products': {
        const data = await this.service.getBottomProducts(range, 100);
        csv =
          'product_id,title,units_sold,revenue\n' +
          data
            .map(
              (p) =>
                `${p.productId},"${escapeCsv(p.title)}",${p.unitsSold},${p.revenue.toFixed(2)}`,
            )
            .join('\n');
        filename = `bottom-products_${dateOnly(range.start)}_${dateOnly(range.end)}.csv`;
        break;
      }
      case 'order-status-mix': {
        const data = await this.service.getOrderStatusMix(range);
        csv =
          'status,count,amount\n' +
          data.map((s) => `${s.status},${s.count},${s.amount.toFixed(2)}`).join('\n');
        filename = `order-status-mix_${dateOnly(range.start)}_${dateOnly(range.end)}.csv`;
        break;
      }
      default:
        throw new BadRequestAppException(`Unknown report: ${report}`);
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function escapeCsv(s: string): string {
  // Inline double-quotes escape per RFC 4180.
  return (s ?? '').replace(/"/g, '""');
}
