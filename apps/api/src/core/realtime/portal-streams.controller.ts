import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  AdminAuthGuard,
  AnyAuthGuard,
  PermissionsGuard,
  SellerAuthGuard,
} from '../guards';
import { Permissions } from '../decorators/permissions.decorator';
import { PortalPushService } from './portal-push.service';

/**
 * Phase 9 (PR 9.1) — SSE entrypoints for the three portals.
 *
 *   GET /portal/streams/admin-queue
 *      — admin dashboard live updates
 *   GET /portal/streams/my-cases
 *      — customer's own returns/disputes/tickets
 *   GET /portal/streams/my-cases/:resourceId
 *      — narrow to one case
 *   GET /portal/streams/seller-disputes
 *      — seller portal: disputes touching their listings
 *
 * The controller's job is bookkeeping:
 *   1. authenticate
 *   2. set SSE headers + flush
 *   3. register the subscriber with PortalPushService
 *   4. on client disconnect, run the unregister teardown
 *
 * Express's `res.writableEnded` + the `close` event drive teardown.
 * Nest's response handling normally serialises the return value, so
 * we use `@Res()` and never return a body — Nest leaves the response
 * untouched.
 */
@ApiTags('Portal Streams')
@Controller('portal/streams')
export class PortalStreamsController {
  constructor(private readonly push: PortalPushService) {}

  @Get('admin-queue')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('audit.read')
  async adminQueue(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.openSse(res);
    const teardown = this.push.register({
      id: randomUUID(),
      scope: { kind: 'admin-queue' },
      res,
      connectedAt: new Date(),
    });
    req.on('close', teardown);
  }

  @Get('my-cases')
  @UseGuards(AnyAuthGuard)
  async myCases(@Req() req: Request, @Res() res: Response): Promise<void> {
    const customerId = (req as any).userId;
    if (!customerId) {
      res.status(401).end();
      return;
    }
    this.openSse(res);
    const teardown = this.push.register({
      id: randomUUID(),
      scope: { kind: 'customer-case', customerId },
      res,
      connectedAt: new Date(),
    });
    req.on('close', teardown);
  }

  @Get('my-cases/:resourceId')
  @UseGuards(AnyAuthGuard)
  async myCase(
    @Req() req: Request,
    @Res() res: Response,
    @Param('resourceId') resourceId: string,
  ): Promise<void> {
    const customerId = (req as any).userId;
    if (!customerId) {
      res.status(401).end();
      return;
    }
    this.openSse(res);
    const teardown = this.push.register({
      id: randomUUID(),
      scope: { kind: 'customer-case', customerId, resourceId },
      res,
      connectedAt: new Date(),
    });
    req.on('close', teardown);
  }

  @Get('seller-disputes')
  @UseGuards(SellerAuthGuard)
  async sellerDisputes(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const sellerId = (req as any).sellerId;
    if (!sellerId) {
      res.status(401).end();
      return;
    }
    this.openSse(res);
    const teardown = this.push.register({
      id: randomUUID(),
      scope: { kind: 'seller-disputes', sellerId },
      res,
      connectedAt: new Date(),
    });
    req.on('close', teardown);
  }

  private openSse(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders?.();
  }
}
