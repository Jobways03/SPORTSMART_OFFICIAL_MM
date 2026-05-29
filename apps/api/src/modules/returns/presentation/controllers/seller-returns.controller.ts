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
import { Throttle } from '@nestjs/throttler';
import { SellerAuthGuard } from '../../../../core/guards';
import { BadRequestAppException } from '../../../../core/exceptions';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { ReturnService } from '../../application/services/return.service';
import { MarkReceivedDto } from '../dtos/mark-received.dto';
import { SellerRespondDto } from '../dtos/seller-respond.dto';
import { SellerRescindResponseDto } from '../dtos/seller-rescind-response.dto';

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
  //
  // Phase 96 (2026-05-23) — Mark Received audit Gap #9 closure.
  // @Idempotent guards against network retries duplicating the
  // status-history row + customer email. Service-side same-state
  // early-return is the belt; this is the suspenders.
  @Patch(':returnId/mark-received')
  @Idempotent()
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
      dto.parcelCondition,
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

  // PATCH /seller/returns/:returnId/respond — Phase 13 (P1.8) seller
  // response to a fault-attribution claim. Seller can ACCEPT (agree
  // with the customer's claim) or CONTEST (disagree, optionally with
  // evidence URLs). Service enforces ownership, deadline, and the
  // PENDING-only state machine.
  //
  // Phase 94 (2026-05-23) — Seller/Franchise Return Response audit:
  //   • @Throttle limit — Gap #18: caps respond storms at 5/min/IP.
  //   • @Idempotent     — Gap #14: double-clicks return the cached
  //                       response instead of throwing "already
  //                       responded" on the retry.
  //   • SellerRespondDto — Gap #11/#12: notes capped at 2000 chars,
  //                       evidence URL array capped at 10 with 2048
  //                       chars each. Service-side host allowlist
  //                       runs after this.
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
      sellerId: req.sellerId,
      decision: body.decision,
      notes: body.notes,
      evidenceFileUrls: body.evidenceFileUrls,
      contestReasonCategory: body.contestReasonCategory,
      itemDecisions: body.itemDecisions,
    });
    return { success: true, message: 'Response recorded', data };
  }

  // Phase 95 (2026-05-23) — Phase 94 deferred #25 closure.
  // PATCH /seller/returns/:returnId/respond/rescind — seller flips
  // their prior ACCEPTED↔CONTESTED while still within the original
  // window + 1h grace.
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
      sellerId: req.sellerId,
      newDecision: body.newDecision,
      notes: body.notes,
      contestReasonCategory: body.contestReasonCategory,
    });
    return { success: true, message: 'Response rescinded', data };
  }

  // QC DECISION — intentionally admin-only.
  //
  // Sellers physically receive the returned package and contribute
  // evidence (photos via /qc-evidence above), but the binding QC
  // outcome that drives refund is reserved for marketplace admins
  // (admin-returns controller's `submitQc` route). Concentrating the
  // decision on the marketplace side keeps a neutral arbiter between
  // buyer + seller and prevents "seller marked it rejected" disputes
  // from short-circuiting the refund.
  //
  // Defence in depth: ReturnService.submitQcDecision additionally
  // refuses non-ADMIN actorType, so even a leaked seller token can't
  // call the service directly.
}
