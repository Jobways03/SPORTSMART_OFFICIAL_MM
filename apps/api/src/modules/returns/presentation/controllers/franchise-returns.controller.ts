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
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { FranchiseAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { ReturnService } from '../../application/services/return.service';
import { MarkReceivedDto } from '../dtos/mark-received.dto';
import { SellerRespondDto } from '../dtos/seller-respond.dto';
import { SellerRescindResponseDto } from '../dtos/seller-rescind-response.dto';

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
  //
  // Phase 96 (2026-05-23) — Mark Received audit Gap #9 closure.
  @Patch(':returnId/mark-received')
  @Idempotent()
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
      dto.parcelCondition,
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

  // PATCH /franchise/returns/:returnId/respond — franchise response to a
  // fault-attribution claim. ACCEPT (agree) or CONTEST (disagree, optionally
  // with evidence URLs). Mirrors the seller respond; the service enforces
  // ownership (subOrder.franchiseId), the deadline, and the PENDING-only state
  // machine.
  @Patch(':returnId/respond')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Idempotent()
  async respond(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() body: SellerRespondDto,
  ) {
    if (body.decision === 'CONTESTED' && !body.notes?.trim()) {
      throw new BadRequestAppException(
        'notes are required when contesting a claim — explain why',
      );
    }
    const data = await this.returnService.respondAsSeller({
      returnId,
      sellerId: req.franchiseId,
      nodeType: 'FRANCHISE',
      decision: body.decision,
      notes: body.notes,
      evidenceFileUrls: body.evidenceFileUrls,
      contestReasonCategory: body.contestReasonCategory,
      itemDecisions: body.itemDecisions,
    });
    return { success: true, message: 'Response recorded', data };
  }

  // PATCH /franchise/returns/:returnId/respond/rescind — franchise flips its
  // prior ACCEPTED↔CONTESTED while still within the original window + 1h grace.
  @Patch(':returnId/respond/rescind')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Idempotent()
  async rescindResponse(
    @Req() req: any,
    @Param('returnId') returnId: string,
    @Body() body: SellerRescindResponseDto,
  ) {
    if (body.newDecision === 'CONTESTED' && !body.notes?.trim()) {
      throw new BadRequestAppException(
        'notes are required when rescinding to CONTESTED — explain why',
      );
    }
    const data = await this.returnService.rescindSellerResponse({
      returnId,
      sellerId: req.franchiseId,
      nodeType: 'FRANCHISE',
      newDecision: body.newDecision,
      notes: body.notes,
      contestReasonCategory: body.contestReasonCategory,
    });
    return { success: true, message: 'Response rescinded', data };
  }

  // QC DECISION — intentionally admin-only.
  //
  // Same rationale as the seller controller: the franchise is the
  // physical receiver and contributes evidence (photos via /qc-evidence
  // above), but the binding QC outcome that drives the refund stays
  // with the marketplace admin to keep a neutral arbiter between buyer
  // and fulfillment node.
  //
  // Defence in depth: ReturnService.submitQcDecision additionally
  // refuses non-ADMIN actorType.
}
