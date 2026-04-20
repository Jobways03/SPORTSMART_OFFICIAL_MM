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
import { FranchiseAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { ReturnService } from '../../application/services/return.service';
import { MarkReceivedDto } from '../dtos/mark-received.dto';
import { SubmitQcDecisionDto } from '../dtos/submit-qc-decision.dto';

const QC_EVIDENCE_UPLOAD_OPTIONS = {
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
};

@ApiTags('Franchise Returns')
@Controller('franchise/returns')
@UseGuards(FranchiseAuthGuard)
export class FranchiseReturnsController {
  constructor(private readonly returnService: ReturnService) {}

  // GET /franchise/returns — list returns assigned to this franchise
  @Get()
  async listMyReturns(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.returnService.listReturnsForFulfillmentNode({
      nodeType: 'FRANCHISE',
      nodeId: req.franchiseId,
      page: Math.max(1, parseInt(page || '1', 10) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit || '20', 10) || 20)),
      status,
    });
    return { success: true, message: 'Returns retrieved', data };
  }

  // GET /franchise/returns/:returnId — return detail (ownership enforced)
  @Get(':returnId')
  async getReturnDetail(
    @Req() req: any,
    @Param('returnId') returnId: string,
  ) {
    const data = await this.returnService.getReturnDetailForNode(
      returnId,
      'FRANCHISE',
      req.franchiseId,
    );
    return { success: true, message: 'Return retrieved', data };
  }

  // PATCH /franchise/returns/:returnId/mark-received — mark package received
  @Patch(':returnId/mark-received')
  async markReceived(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: MarkReceivedDto,
  ) {
    await this.returnService.assertNodeOwnsReturn(
      returnId,
      'FRANCHISE',
      req.franchiseId,
    );
    const data = await this.returnService.markReceived(
      returnId,
      'FRANCHISE',
      req.franchiseId,
      dto.notes,
    );
    return { success: true, message: 'Return marked as received', data };
  }

  // POST /franchise/returns/:returnId/qc-evidence — upload QC evidence image
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
      'FRANCHISE',
      req.franchiseId,
    );
    if (!file?.buffer) {
      throw new BadRequestAppException('Image file required');
    }
    const data = await this.returnService.uploadQcEvidence(
      returnId,
      'FRANCHISE',
      req.franchiseId,
      file.buffer,
      file.mimetype,
      body?.description,
    );
    return { success: true, message: 'Evidence uploaded', data };
  }

  // PATCH /franchise/returns/:returnId/qc-decision — submit per-item QC decision
  @Patch(':returnId/qc-decision')
  async submitQc(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() dto: SubmitQcDecisionDto,
  ) {
    await this.returnService.assertNodeOwnsReturn(
      returnId,
      'FRANCHISE',
      req.franchiseId,
    );
    const data = await this.returnService.submitQcDecision(
      returnId,
      'FRANCHISE',
      req.franchiseId,
      dto,
    );
    return { success: true, message: 'QC decision submitted', data };
  }
}
