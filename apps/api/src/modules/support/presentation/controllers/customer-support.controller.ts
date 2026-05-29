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
import { UserAuthGuard } from '../../../../core/guards';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { SupportService } from '../../application/services/support.service';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CreateTicketDto, ReplyDto } from '../dtos/support.dtos';

@ApiTags('Support — Customer')
@Controller('customer/support')
@UseGuards(UserAuthGuard)
export class CustomerSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Categories ────────────────────────────────────────────────────

  @Get('categories')
  async listCategories() {
    const data = await this.support.listCategories('CUSTOMER');
    return { success: true, message: 'Categories retrieved', data };
  }

  // ── Tickets ───────────────────────────────────────────────────────

  @Post('tickets')
  @Idempotent()
  async createTicket(@Req() req: any, @Body() body: CreateTicketDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (!user) {
      return { success: false, message: 'User not found' };
    }
    const ticket = await this.support.createTicket({
      creator: {
        type: 'CUSTOMER',
        id: req.userId,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
      },
      subject: body.subject,
      body: body.body,
      priority: body.priority,
      categoryId: body.categoryId,
      relatedOrderId: body.relatedOrderId,
      relatedReturnId: body.relatedReturnId,
      relatedOrderNumber: body.relatedOrderNumber,
      relatedReturnNumber: body.relatedReturnNumber,
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
      { type: 'CUSTOMER', id: req.userId },
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
      type: 'CUSTOMER',
      id: req.userId,
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
    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: { firstName: true, lastName: true },
    });
    const data = await this.support.reply({
      ticketId: id,
      sender: {
        type: 'CUSTOMER',
        id: req.userId,
        name: user
          ? `${user.firstName} ${user.lastName}`.trim()
          : 'Customer',
      },
      body: body.body,
    });
    return { success: true, message: 'Reply sent', data };
  }

  @Post('tickets/:id/close')
  async close(@Req() req: any, @Param('id') id: string) {
    const data = await this.support.closeByCustomer(id, {
      type: 'CUSTOMER',
      id: req.userId,
    });
    return { success: true, message: 'Ticket closed', data };
  }
}
