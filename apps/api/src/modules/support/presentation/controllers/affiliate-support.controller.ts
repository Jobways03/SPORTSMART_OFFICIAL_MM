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
import { AffiliateAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { SupportService } from '../../application/services/support.service';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CreateTicketDto, ReplyDto } from '../dtos/support.dtos';

@ApiTags('Support — Affiliate')
@Controller('affiliate/support')
@UseGuards(AffiliateAuthGuard)
export class AffiliateSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('categories')
  async listCategories() {
    const data = await this.support.listCategories('AFFILIATE');
    return { success: true, message: 'Categories retrieved', data };
  }

  @Post('tickets')
  @Idempotent()
  async createTicket(@Req() req: any, @Body() body: CreateTicketDto) {
    const aff = await this.prisma.affiliate.findUnique({
      where: { id: req.affiliateId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!aff) throw new NotFoundAppException('Affiliate not found');
    const ticket = await this.support.createTicket({
      creator: {
        type: 'AFFILIATE',
        id: req.affiliateId,
        name: `${aff.firstName} ${aff.lastName}`.trim(),
        email: aff.email,
      },
      subject: body.subject,
      body: body.body,
      priority: body.priority,
      categoryId: body.categoryId,
      relatedOrderId: body.relatedOrderId,
      relatedReturnId: body.relatedReturnId,
    });
    return { success: true, message: 'Ticket created', data: ticket };
  }

  @Get('tickets')
  async listMyTickets(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.support.listTicketsForCreator(
      { type: 'AFFILIATE', id: req.affiliateId },
      {
        page: parseInt(page || '1', 10) || 1,
        limit: parseInt(limit || '20', 10) || 20,
        status: status ? (status as any) : undefined,
      },
    );
    return { success: true, message: 'Tickets retrieved', data };
  }

  @Get('tickets/:id')
  async getTicket(@Req() req: any, @Param('id') id: string) {
    const data = await this.support.getTicketDetailForActor(id, {
      type: 'AFFILIATE',
      id: req.affiliateId,
      isAdmin: false,
    });
    return { success: true, message: 'Ticket retrieved', data };
  }

  @Post('tickets/:id/messages')
  @Idempotent()
  async reply(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ReplyDto,
  ) {
    const aff = await this.prisma.affiliate.findUnique({
      where: { id: req.affiliateId },
      select: { firstName: true, lastName: true },
    });
    const data = await this.support.reply({
      ticketId: id,
      sender: {
        type: 'AFFILIATE',
        id: req.affiliateId,
        name: aff
          ? `${aff.firstName} ${aff.lastName}`.trim()
          : 'Affiliate',
      },
      body: body.body,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Post('tickets/:id/close')
  async close(@Req() req: any, @Param('id') id: string) {
    const data = await this.support.closeByCustomer(id, {
      type: 'AFFILIATE',
      id: req.affiliateId,
    });
    return { success: true, message: 'Ticket closed', data };
  }
}
