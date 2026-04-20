import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard, RolesGuard } from '../../../../core/guards';
import { Roles } from '../../../../core/decorators/roles.decorator';
import { OrdersService } from '../../application/services/orders.service';

@ApiTags('Admin Orders')
@Controller('admin/orders')
@UseGuards(AdminAuthGuard, RolesGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async listOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
    @Query('acceptStatus') acceptStatus?: string,
    @Query('orderStatus') orderStatus?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.ordersService.listOrders({
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(50, Math.max(1, parseInt(limit || '20', 10) || 20)),
      paymentStatus,
      fulfillmentStatus,
      acceptStatus,
      orderStatus,
      search,
    });
    return { success: true, message: 'Orders retrieved', data };
  }

  @Get(':id')
  async getOrder(@Param('id') id: string) {
    const data = await this.ordersService.getOrder(id);
    return { success: true, message: 'Order retrieved', data };
  }

  @Post(':id/verify')
  async verifyOrder(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: { remarks?: string },
  ) {
    const data = await this.ordersService.verifyOrder(id, req.userId, body.remarks);
    return { success: true, message: 'Order verified and routed to sellers', data };
  }

  @Patch(':id/reject-order')
  @Roles('SUPER_ADMIN')
  async rejectOrder(@Param('id') id: string) {
    await this.ordersService.rejectOrder(id);
    return { success: true, message: 'Order rejected and cancelled — stock restored' };
  }

  // The sub-order state-machine overrides below all bypass the normal
  // lifecycle (seller accept → pack → ship → deliver) and can force
  // arbitrary transitions without corresponding commission / stock
  // side-effects. Reserved for SUPER_ADMIN because a wrong transition
  // from a lower-tier admin can detach the ledger from physical reality
  // (e.g. reversing DELIVERED → UNFULFILLED while goods are with the
  // customer). Same principle as the money / account operations locked
  // down in admin-settlement / admin-commission / admin-sellers.
  @Patch('sub-orders/:id/accept')
  @Roles('SUPER_ADMIN')
  async acceptSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.acceptSubOrder(id);
    return { success: true, message: 'Sub-order accepted', data };
  }

  @Patch('sub-orders/:id/reject')
  @Roles('SUPER_ADMIN')
  async rejectSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.rejectSubOrder(id);
    return { success: true, message: 'Sub-order rejected', data };
  }

  @Patch('sub-orders/:id/fulfill')
  @Roles('SUPER_ADMIN')
  async fulfillSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.fulfillSubOrder(id);
    return { success: true, message: 'Sub-order fulfilled', data };
  }

  @Patch('sub-orders/:id/deliver')
  @Roles('SUPER_ADMIN')
  async deliverSubOrder(@Param('id') id: string) {
    const data = await this.ordersService.deliverSubOrder(id);
    return { success: true, message: 'Sub-order marked as delivered — return window started', data };
  }

  @Post('sub-orders/:subOrderId/mark-delivered')
  async markSubOrderDelivered(@Param('subOrderId') subOrderId: string) {
    const data = await this.ordersService.deliverSubOrder(subOrderId);
    return { success: true, message: 'Sub-order marked as delivered — return window started', data };
  }

  @Patch(':id/mark-paid')
  async markAsPaid(@Param('id') id: string) {
    await this.ordersService.markAsPaid(id);
    return { success: true, message: 'Order marked as paid' };
  }

  // ── Epic 2: Manual Reassignment & Exception Queue ──────────────────────

  @Get('sub-orders/:subOrderId/eligible-sellers')
  async getEligibleSellers(@Param('subOrderId') subOrderId: string) {
    const data = await this.ordersService.getEligibleSellers(subOrderId);
    return { success: true, message: 'Eligible sellers retrieved', data };
  }

  /**
   * Node-agnostic candidate list. Returns both sellers AND franchises that
   * can fulfill this sub-order, each with a `nodeType` discriminator.
   * Prefer this over the legacy `eligible-sellers` endpoint.
   */
  @Get('sub-orders/:subOrderId/eligible-nodes')
  async getEligibleNodes(@Param('subOrderId') subOrderId: string) {
    const data = await this.ordersService.getEligibleNodes(subOrderId);
    return { success: true, message: 'Eligible nodes retrieved', data };
  }

  /**
   * Reassign a sub-order to a new fulfillment node.
   *
   * Preferred body shape: `{ nodeType: 'SELLER'|'FRANCHISE', nodeId, reason? }`.
   * Legacy shape `{ sellerId, reason? }` is still accepted and maps to a
   * SELLER target.
   */
  @Post('sub-orders/:subOrderId/reassign')
  async reassignSubOrder(
    @Param('subOrderId') subOrderId: string,
    @Body()
    body: {
      nodeType?: 'SELLER' | 'FRANCHISE';
      nodeId?: string;
      sellerId?: string;
      reason?: string;
    },
  ) {
    const target =
      body.nodeType && body.nodeId
        ? ({ nodeType: body.nodeType, nodeId: body.nodeId } as const)
        : body.sellerId
          ? ({ nodeType: 'SELLER', nodeId: body.sellerId } as const)
          : null;

    if (!target) {
      return {
        success: false,
        message:
          'Reassignment target required — provide { nodeType, nodeId } or legacy { sellerId }',
      };
    }

    const data = await this.ordersService.reassignSubOrder(
      subOrderId,
      target,
      body.reason,
    );
    return { success: true, message: 'Sub-order reassigned successfully', data };
  }

  @Get(':id/reassignment-history')
  async getReassignmentHistory(@Param('id') id: string) {
    const data = await this.ordersService.getReassignmentHistory(id);
    return { success: true, message: 'Reassignment history retrieved', data };
  }

  /**
   * Mid-flow cancel for a single sub-order. Safe to call at any stage
   * except DELIVERED (use the returns flow for that). Releases stock holds
   * on whichever node currently owns the sub-order (seller or franchise).
   */
  @Patch('sub-orders/:subOrderId/cancel')
  async cancelSubOrder(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Body() body: { reason?: string },
  ) {
    const data = await this.ordersService.adminCancelSubOrder(
      subOrderId,
      req.adminId,
      body?.reason,
    );
    return {
      success: true,
      message: 'Sub-order cancelled',
      data,
    };
  }
}
