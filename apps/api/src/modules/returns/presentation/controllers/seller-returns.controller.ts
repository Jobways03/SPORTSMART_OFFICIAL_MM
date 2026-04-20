import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { SellerAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReturnService } from '../../application/services/return.service';
import { MarkReceivedDto } from '../dtos/mark-received.dto';
import { SubmitQcDecisionDto } from '../dtos/submit-qc-decision.dto';

const QC_EVIDENCE_UPLOAD_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

@ApiTags('Seller Returns')
@Controller('seller/returns')
@UseGuards(SellerAuthGuard)
export class SellerReturnsController {
  constructor(private readonly returnService: ReturnService) {}

  // GET /seller/returns — list returns assigned to this seller
  @Get()
  async listMyReturns(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.returnService.listReturnsForFulfillmentNode({
      nodeType: 'SELLER',
      nodeId: req.sellerId,
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20)),
      status,
    });
    return { success: true, message: 'Returns retrieved', data };
  }

  // GET /seller/returns/:returnId — return detail (ownership enforced)
  @Get(':returnId')
  async getReturnDetail(
    @Req() req: any,
    @Param('returnId') returnId: string,
  ) {
    const data = await this.returnService.getReturnDetailForNode(
      returnId,
      'SELLER',
      req.sellerId,
    );
    return { success: true, message: 'Return retrieved', data };
  }

  // PATCH /seller/returns/:returnId/mark-received — mark package received
  @Patch(':returnId/mark-received')
  async markReceived(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: MarkReceivedDto,
  ) {
    await this.returnService.assertNodeOwnsReturn(
      returnId,
      'SELLER',
      req.sellerId,
    );
    const data = await this.returnService.markReceived(
      returnId,
      'SELLER',
      req.sellerId,
      dto.notes,
    );
    return { success: true, message: 'Return marked as received', data };
  }

  // POST /seller/returns/:returnId/qc-evidence — upload QC evidence image
  @Post(':returnId/qc-evidence')
  @UseInterceptors(FileInterceptor('image', QC_EVIDENCE_UPLOAD_OPTIONS))
  async uploadEvidence(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { description?: string },
  ) {
    await this.returnService.assertNodeOwnsReturn(
      returnId,
      'SELLER',
      req.sellerId,
    );
    if (!file?.buffer) {
      throw new BadRequestAppException('Image file required');
    }
    const data = await this.returnService.uploadQcEvidence(
      returnId,
      'SELLER',
      req.sellerId,
      file.buffer,
      file.mimetype,
      body?.description,
    );
    return { success: true, message: 'Evidence uploaded', data };
  }

  // PATCH /seller/returns/:returnId/qc-decision — submit per-item QC decision
  @Patch(':returnId/qc-decision')
  async submitQc(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: SubmitQcDecisionDto,
  ) {
    await this.returnService.assertNodeOwnsReturn(
      returnId,
      'SELLER',
      req.sellerId,
    );
    const data = await this.returnService.submitQcDecision(
      returnId,
      'SELLER',
      req.sellerId,
      dto,
    );
    return { success: true, message: 'QC decision submitted', data };
  }
}
