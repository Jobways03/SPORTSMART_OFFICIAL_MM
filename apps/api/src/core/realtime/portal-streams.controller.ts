import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  AdminAuthGuard,
  AffiliateAuthGuard,
  FranchiseAuthGuard,
  PermissionsGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../guards';
import { Permissions } from '../decorators/permissions.decorator';
import { PortalPushService } from './portal-push.service';
import { EventFamily, SubscriberScope } from './portal-sse.types';

/**
 * Phase 9 (PR 9.1) — SSE entrypoints for the three portals.
 *
 *   GET /portal/streams/admin-queue      — admin dashboard (ops only)
 *   GET /portal/streams/my-cases         — customer's own cases
 *   GET /portal/streams/my-cases/:id     — narrow to one owned case
 *   GET /portal/streams/seller-disputes  — seller portal disputes
 *
 * Hardened (Portal-SSE audit): customer routes use the customer-scoped
 * UserAuthGuard (the old AnyAuthGuard never set req.userId → always 401,
 * and accepted any persona); admin route gates on a dedicated CRITICAL
 * permission; every route is rate-limited, supports Last-Event-Id replay,
 * verifies resource ownership at subscribe, and disables compression
 * buffering on the response.
 */
@ApiTags('Portal Streams')
@Controller('portal/streams')
// Cap reconnect/open rate per route to blunt connection-spam DoS.
@Throttle({ default: { limit: 12, ttl: 60_000 } })
export class PortalStreamsController {
  constructor(private readonly push: PortalPushService) {}

  @Get('admin-queue')
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @Permissions('portal.streams.admin.read')
  async adminQueue(
    @Req() req: Request,
    @Res() res: Response,
    @Query('queues') queues?: string,
  ): Promise<void> {
    const adminId = this.actorId(req);
    this.openSse(res);
    const scope: SubscriberScope = {
      kind: 'admin-queue',
      queues: this.parseQueues(queues),
    };
    this.attach(req, res, scope, `admin:${adminId}`, adminId, 'ADMIN');
  }

  @Get('my-cases')
  @UseGuards(UserAuthGuard)
  async myCases(@Req() req: Request, @Res() res: Response): Promise<void> {
    const customerId = (req as any).userId as string | undefined;
    if (!customerId) {
      res.status(401).end();
      return;
    }
    this.openSse(res);
    this.attach(
      req,
      res,
      { kind: 'customer-case', customerId },
      `customer:${customerId}`,
      customerId,
      'CUSTOMER',
    );
  }

  @Get('my-cases/:resourceId')
  @UseGuards(UserAuthGuard)
  async myCase(
    @Req() req: Request,
    @Res() res: Response,
    @Param('resourceId') resourceId: string,
  ): Promise<void> {
    const customerId = (req as any).userId as string | undefined;
    if (!customerId) {
      res.status(401).end();
      return;
    }
    // Verify ownership BEFORE opening the stream — block watching a case
    // that isn't yours even though the live matcher would also drop it.
    const owns = await this.push.customerOwnsResource(customerId, resourceId);
    if (!owns) {
      res.status(403).end();
      return;
    }
    this.openSse(res);
    this.attach(
      req,
      res,
      { kind: 'customer-case', customerId, resourceId },
      `customer:${customerId}`,
      customerId,
      'CUSTOMER',
    );
  }

  @Get('seller-disputes')
  @UseGuards(SellerAuthGuard)
  async sellerDisputes(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sellerId = (req as any).sellerId as string | undefined;
    if (!sellerId) {
      res.status(401).end();
      return;
    }
    this.openSse(res);
    this.attach(
      req,
      res,
      { kind: 'seller-disputes', sellerId },
      `seller:${sellerId}`,
      sellerId,
      'SELLER',
    );
  }

  @Get('franchise-cases')
  @UseGuards(FranchiseAuthGuard)
  async franchiseCases(@Req() req: Request, @Res() res: Response): Promise<void> {
    const franchiseId = (req as any).franchiseId as string | undefined;
    if (!franchiseId) {
      res.status(401).end();
      return;
    }
    this.openSse(res);
    this.attach(
      req,
      res,
      { kind: 'franchise-cases', franchiseId },
      `franchise:${franchiseId}`,
      franchiseId,
      'FRANCHISE',
    );
  }

  @Get('affiliate-earnings')
  @UseGuards(AffiliateAuthGuard)
  async affiliateEarnings(@Req() req: Request, @Res() res: Response): Promise<void> {
    const affiliateId = (req as any).affiliateId as string | undefined;
    if (!affiliateId) {
      res.status(401).end();
      return;
    }
    this.openSse(res);
    this.attach(
      req,
      res,
      { kind: 'affiliate-earnings', affiliateId },
      `affiliate:${affiliateId}`,
      affiliateId,
      'AFFILIATE',
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private attach(
    req: Request,
    res: Response,
    scope: SubscriberScope,
    actorKey: string,
    actorId: string,
    actorType: string,
  ): void {
    const lastEventId =
      (req.headers['last-event-id'] as string | undefined) ||
      (req.query['lastEventId'] as string | undefined);
    const teardown = this.push.register(
      {
        id: randomUUID(),
        scope,
        actorKey,
        actorId,
        actorType,
        res,
        connectedAt: new Date(),
        failedWrites: 0,
      },
      { lastEventId },
    );
    // Belt-and-braces: tear down on both the request- and response-side
    // close so a server-side timeout can't leak the subscriber.
    req.on('close', teardown);
    res.on('close', teardown);
  }

  private parseQueues(queues?: string): ReadonlyArray<EventFamily> | undefined {
    if (!queues) return undefined;
    const valid: EventFamily[] = ['returns', 'disputes', 'tickets', 'sla'];
    const parsed = queues
      .split(',')
      .map((q) => q.trim().toLowerCase())
      .filter((q): q is EventFamily => (valid as string[]).includes(q));
    return parsed.length > 0 ? parsed : undefined;
  }

  private actorId(req: Request): string {
    return (
      ((req as any).adminId as string | undefined) ??
      ((req as any).user?.id as string | undefined) ??
      ((req as any).authActorId as string | undefined) ??
      'unknown'
    );
  }

  private openSse(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    // Defeat the gzip middleware: SSE must stream, never buffer. The
    // compression filter also skips text/event-stream, this is belt-and-
    // braces for any proxy that honours the response encoding.
    res.setHeader('Content-Encoding', 'identity');
    res.flushHeaders?.();
  }
}
