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
import { SellerAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../../../core/exceptions';
import { SupportService } from '../../application/services/support.service';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CreateTicketDto, ReplyDto } from '../dtos/support.dtos';

@ApiTags('Support — Seller')
@Controller('seller/support')
@UseGuards(SellerAuthGuard)
export class SellerSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('categories')
  async listCategories() {
    const data = await this.support.listCategories('SELLER');
    return { success: true, message: 'Categories retrieved', data };
  }

  @Post('tickets')
  @Idempotent()
  async createTicket(@Req() req: any, @Body() body: CreateTicketDto) {
    const seller = await this.prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: { sellerName: true, email: true },
    });
    if (!seller) throw new NotFoundAppException('Seller not found');
    const ticket = await this.support.createTicket({
      creator: {
        type: 'SELLER',
        id: req.sellerId,
        name: seller.sellerName,
        email: seller.email,
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
      { type: 'SELLER', id: req.sellerId },
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
      type: 'SELLER',
      id: req.sellerId,
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
    const seller = await this.prisma.seller.findUnique({
      where: { id: req.sellerId },
      select: { sellerName: true },
    });
    const data = await this.support.reply({
      ticketId: id,
      sender: {
        type: 'SELLER',
        id: req.sellerId,
        name: seller?.sellerName ?? 'Seller',
      },
      body: body.body,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Post('tickets/:id/close')
  async close(@Req() req: any, @Param('id') id: string) {
    const data = await this.support.closeByCustomer(id, {
      type: 'SELLER',
      id: req.sellerId,
    });
    return { success: true, message: 'Ticket closed', data };
  }
}
