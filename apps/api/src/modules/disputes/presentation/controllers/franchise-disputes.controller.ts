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
import { FranchiseAuthGuard } from '../../../../core/guards';
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
 * Franchise dispute endpoints — mirror of the seller controller. Access control
 * is FranchiseAuthGuard + the service-level ownership check
 * (DisputeService.assertFilerOwnsLinks), which only lets a franchise anchor a
 * dispute on a sub-order / return it fulfils.
 */
@ApiTags('Disputes — Franchise')
@Controller('franchise/disputes')
@UseGuards(FranchiseAuthGuard)
export class FranchiseDisputesController {
  constructor(
    private readonly service: DisputeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  // A network retry must not create a duplicate dispute. Requires
  // X-Idempotency-Key.
  @Idempotent()
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async file(@Req() req: any, @Body() body: FileDisputeDto) {
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: req.franchiseId },
      select: { businessName: true },
    });
    if (!franchise) throw new NotFoundAppException('Franchise not found');
    // fileDispute enforces that the linked sub-order/return belongs to this
    // franchise (ownership guard).
    const data = await this.service.fileDispute({
      filer: {
        type: 'FRANCHISE',
        id: req.franchiseId,
        name: franchise.businessName,
      },
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
    // Returns disputes filed by this franchise AND disputes filed against
    // their sub-orders — the franchise-portal "all my disputes" view.
    const data = await this.service.listAgainstFranchise(
      req.franchiseId,
      parseInt(page || '1', 10) || 1,
      parseInt(limit || '20', 10) || 20,
      status ? (status as DisputeStatus) : undefined,
    );
    return { success: true, message: 'Disputes retrieved', data };
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.getDisputeForActor(id, {
      type: 'FRANCHISE',
      id: req.franchiseId,
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
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: req.franchiseId },
      select: { businessName: true },
    });
    const data = await this.service.reply({
      disputeId: id,
      sender: {
        type: 'FRANCHISE',
        id: req.franchiseId,
        name: franchise?.businessName ?? 'Franchise',
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
    await this.service.getDisputeForActor(id, {
      type: 'FRANCHISE',
      id: req.franchiseId,
      isAdmin: false,
    });
    const data = await this.service.attachEvidence({
      disputeId: id,
      fileId: body.fileId.trim(),
      caption: body.caption?.trim(),
      uploader: { type: 'FRANCHISE', id: req.franchiseId },
    });
    return { success: true, message: 'Evidence attached', data };
  }
}
