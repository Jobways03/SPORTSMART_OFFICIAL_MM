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
import { UserAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException, NotFoundAppException } from '../../../../core/exceptions';
import { DisputeService } from '../../application/services/dispute.service';

interface FileDisputeDto {
  kind: DisputeKind;
  summary: string;
  masterOrderId?: string;
  subOrderId?: string;
  returnId?: string;
}

interface ReplyDto {
  body: string;
}

@ApiTags('Disputes — Customer')
@Controller('customer/disputes')
@UseGuards(UserAuthGuard)
export class CustomerDisputesController {
  constructor(
    private readonly service: DisputeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async file(@Req() req: any, @Body() body: FileDisputeDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: { firstName: true, lastName: true },
    });
    if (!user) throw new NotFoundAppException('User not found');
    const data = await this.service.fileDispute({
      filer: {
        type: 'CUSTOMER',
        id: req.userId,
        name: `${user.firstName} ${user.lastName}`.trim(),
      },
      kind: body.kind,
      summary: body.summary,
      masterOrderId: body.masterOrderId,
      subOrderId: body.subOrderId,
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
    const data = await this.service.listForActor(
      { type: 'CUSTOMER', id: req.userId },
      parseInt(page || '1', 10) || 1,
      parseInt(limit || '20', 10) || 20,
      status ? (status as DisputeStatus) : undefined,
    );
    return { success: true, message: 'Disputes retrieved', data };
  }

  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.getDisputeForActor(id, {
      type: 'CUSTOMER', id: req.userId, isAdmin: false,
    });
    return { success: true, message: 'Dispute retrieved', data };
  }

  @Post(':id/messages')
  async reply(@Req() req: any, @Param('id') id: string, @Body() body: ReplyDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: { firstName: true, lastName: true },
    });
    const data = await this.service.reply({
      disputeId: id,
      sender: {
        type: 'CUSTOMER', id: req.userId,
        name: user ? `${user.firstName} ${user.lastName}`.trim() : 'Customer',
      },
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
    // The service's getDisputeForActor already enforces ownership; we
    // call it just for the side-effect of access checking.
    await this.service.getDisputeForActor(id, {
      type: 'CUSTOMER', id: req.userId, isAdmin: false,
    });
    const data = await this.service.attachEvidence({
      disputeId: id,
      fileId: body.fileId.trim(),
      caption: body.caption?.trim(),
      uploader: { type: 'CUSTOMER', id: req.userId },
    });
    return { success: true, message: 'Evidence attached', data };
  }
}
