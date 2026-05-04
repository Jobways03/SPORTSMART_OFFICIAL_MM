import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { OwnBrandService } from '../../application/services/own-brand.service';
import {
  CreateProcurementDto,
  ReceiveProcurementDto,
  TransitionStatusDto,
} from '../dtos/own-brand.dtos';

@ApiTags('NOVA — Procurement')
@Controller('admin/nova/procurement')
@UseGuards(AdminAuthGuard)
export class AdminNovaProcurementController {
  constructor(private readonly service: OwnBrandService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const data = await this.service.listProcurement({
      page: parseInt(page || '1', 10) || 1,
      limit: parseInt(limit || '20', 10) || 20,
      warehouseId,
      status: status ? (status as any) : undefined,
      search: search?.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
    return { success: true, message: 'POs retrieved', data };
  }

  @Get(':id/receipts')
  async listReceipts(@Param('id') id: string) {
    const data = await this.service.listReceiptsForPo(id);
    return { success: true, message: 'Receipts retrieved', data };
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const data = await this.service.getProcurement(id);
    return { success: true, message: 'PO retrieved', data };
  }

  @Post()
  async create(@Req() req: any, @Body() body: CreateProcurementDto) {
    const data = await this.service.createProcurement({
      warehouseId: body.warehouseId,
      supplierName: body.supplierName,
      expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
      supplierReference: body.supplierReference,
      notes: body.notes,
      items: body.items.map((it) => ({
        productId: it.productId,
        variantId: it.variantId ?? null,
        quantityOrdered: Number(it.quantityOrdered),
        unitCost: Number(it.unitCost),
      })),
      createdByAdminId: req.adminId,
    });
    return { success: true, message: 'PO created', data };
  }

  @Patch(':id/status')
  async transitionStatus(
    @Param('id') id: string,
    @Body() body: TransitionStatusDto,
  ) {
    if (!body?.status) throw new BadRequestAppException('status is required');
    const data = await this.service.transitionStatus(id, body.status);
    return { success: true, message: 'PO status updated', data };
  }

  @Post(':id/receive')
  async receive(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ReceiveProcurementDto & { receipts: Array<{ itemId: string; quantityReceived: number; notes?: string }> },
  ) {
    if (!body?.receipts?.length) {
      throw new BadRequestAppException('receipts is required');
    }
    const data = await this.service.receiveProcurement({
      poId: id,
      receipts: body.receipts.map((r) => ({
        itemId: r.itemId,
        quantityReceived: Number(r.quantityReceived),
        notes: r.notes,
      })),
      receivedByAdminId: req.adminId,
    });
    return { success: true, message: 'Receipt applied', data };
  }
}
