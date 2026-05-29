import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { DisputeStatus } from '@prisma/client';
import { SellerAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { DisputeService } from '../../application/services/dispute.service';
import {
  FileDisputeDto,
  ReplyDisputeDto,
  AttachEvidenceDto,
} from '../dtos/dispute.dtos';

/**
 * Seller dispute endpoints. D2C and RETAIL sellers intentionally share this
 * single path — disputes (like returns / settlements / tax) use the same
 * plumbing for both seller types, so there is deliberately no D2cOnlyGuard /
 * RetailOnlyGuard here. Access control is SellerAuthGuard + the service-level
 * ownership check (DisputeService.assertFilerOwnsLinks). See seller-type.guard.ts
 * for why the type guards are unused by design.
 */
@ApiTags('Disputes — Seller')
@Controller('seller/disputes')
@UseGuards(SellerAuthGuard)
export class SellerDisputesController {
  constructor(
    private readonly service: DisputeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  // Phase 110 — parity with the (now-removed) customer endpoint: a network
  // retry must not create a duplicate dispute. Requires X-Idempotency-Key.
  @Idempotent()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async file(@Req() req: any, @Body() body: FileDisputeDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: { sellerName: true },
    });
    if (!seller) throw new NotFoundAppException('Seller not found');
    // fileDispute enforces that the linked sub-order/return belongs to this
    // seller (Phase 110 ownership guard).
    const data = await this.service.fileDispute({
      filer: { type: 'SELLER', id: req.sellerId, name: seller.sellerName },
      kind: body.kind,
      summary: body.summary,
      subOrderId: body.subOrderId,
      masterOrderId: body.masterOrderId,
      returnId: body.returnId,
    });
    return { success: true, message: 'Dispute filed', data };
  }

  @Get()
  async listMine(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    // Returns disputes filed by this seller AND disputes filed against
    // their sub-orders — the seller-portal "all my disputes" view.
    const data = await this.service.listAgainstSeller(
      req.sellerId,
      parseInt(page || '1', 10) || 1,
      parseInt(limit || '20', 10) || 20,
      status ? (status as DisputeStatus) : undefined,
    );
    return { success: true, message: 'Disputes retrieved', data };
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.getDisputeForActor(id, {
      type: 'SELLER',
      id: req.sellerId,
      isAdmin: false,
    });
    return { success: true, message: 'Dispute retrieved', data };
  }

  @Post(':id/messages')
  @Idempotent()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async reply(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ReplyDisputeDto,
  ) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: { sellerName: true },
    });
    const data = await this.service.reply({
      disputeId: id,
      sender: {
        type: 'SELLER',
        id: req.sellerId,
        name: seller?.sellerName ?? 'Seller',
      },
      body: body.body,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Post(':id/evidence')
  @Idempotent()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async attachEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: AttachEvidenceDto,
  ) {
    // getDisputeForActor enforces dispute access; the service's attachEvidence
    // enforces evidence-file ownership + existence.
    await this.service.getDisputeForActor(id, {
      type: 'SELLER',
      id: req.sellerId,
      isAdmin: false,
    });
    const data = await this.service.attachEvidence({
      disputeId: id,
      fileId: body.fileId.trim(),
      caption: body.caption?.trim(),
      uploader: { type: 'SELLER', id: req.sellerId },
    });
    return { success: true, message: 'Evidence attached', data };
  }
}
