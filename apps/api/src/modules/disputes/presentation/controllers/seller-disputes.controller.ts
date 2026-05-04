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
import type { DisputeKind, DisputeStatus } from '@prisma/client';
import { SellerAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { DisputeService } from '../../application/services/dispute.service';

@ApiTags('Disputes — Seller')
@Controller('seller/disputes')
@UseGuards(SellerAuthGuard)
export class SellerDisputesController {
  constructor(
    private readonly service: DisputeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async file(@Req() req: any, @Body() body: {
    kind: DisputeKind; summary: string;
    subOrderId?: string; masterOrderId?: string; returnId?: string;
  }) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: req.sellerId }, select: { sellerName: true },
    });
    if (!seller) throw new NotFoundAppException('Seller not found');
    const data = await this.service.fileDispute({
      filer: { type: 'SELLER', id: req.sellerId, name: seller.sellerName },
      kind: body.kind, summary: body.summary,
      subOrderId: body.subOrderId, masterOrderId: body.masterOrderId, returnId: body.returnId,
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
      type: 'SELLER', id: req.sellerId, isAdmin: false,
    });
    return { success: true, message: 'Dispute retrieved', data };
  }

  @Post(':id/messages')
  async reply(@Req() req: any, @Param('id') id: string, @Body() body: { body: string }) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: req.sellerId }, select: { sellerName: true },
    });
    const data = await this.service.reply({
      disputeId: id,
      sender: { type: 'SELLER', id: req.sellerId, name: seller?.sellerName ?? 'Seller' },
      body: body.body,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Post(':id/evidence')
  async attachEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { fileId: string; caption?: string },
  ) {
    if (!body?.fileId?.trim()) {
      throw new BadRequestAppException('fileId is required');
    }
    // getDisputeForActor enforces that the seller is either the filer
    // or the affected seller of this dispute.
    await this.service.getDisputeForActor(id, {
      type: 'SELLER', id: req.sellerId, isAdmin: false,
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
