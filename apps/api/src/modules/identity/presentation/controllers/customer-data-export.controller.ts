import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Header,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { UserAuthGuard } from '../../../../core/guards';
import { CustomerDataExportService } from '../../application/services/customer-data-export.service';

/**
 * Customer data export endpoint (DPDP §11 right-to-data-portability).
 *
 * GET /customer/data-export
 *   Returns a downloadable JSON file containing every piece of PII
 *   we hold about the authenticated customer. The `Content-Disposition`
 *   header instructs the browser to save the response rather than
 *   render it.
 *
 * Throttle: 3 calls per hour. Building the bundle is read-heavy (joins
 * 8+ tables) and the customer doesn't need it more often than that.
 * The throttle decorator stacks on top of the global guard.
 */
@ApiTags('Customer DPDP')
@Controller('customer/data-export')
@UseGuards(UserAuthGuard)
export class CustomerDataExportController {
  constructor(private readonly exportService: CustomerDataExportService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60 * 60 * 1000 } })
  @Header('Content-Type', 'application/json; charset=utf-8')
  async export(
    @Req() req: Request & { userId?: string },
    @Res() res: Response,
  ): Promise<void> {
    if (!req.userId) {
      throw new UnauthorizedException('Customer session not found');
    }

    const payload = await this.exportService.exportFor(req.userId, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? undefined,
    });

    const filename = `sportsmart-data-export-${req.userId}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    // Use res.send so the existing JSON serialisation (which the
    // service already ran for BigInts) goes straight through without
    // being touched by the GlobalInterceptor's success-envelope
    // wrapper — the customer wants raw data, not `{success:true,data:{...}}`.
    res.send(payload);
  }
}
