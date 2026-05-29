import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBody, ApiConsumes } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { SellerAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FileService } from '../../../files/application/services/file.service';
import { ShipmentEvidenceService } from '../../../shipping/application/services/shipment-evidence.service';

const UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024;

// Phase 88 (2026-05-23) — Gap #23 DX. Documented soft-delete body.
export class DeleteEvidenceDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

// Phase 88 — Gap #23. Multipart upload contract is now Swagger-typed.
export class UploadEvidenceFormDto {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image!: any;

  @IsOptional()
  @IsString()
  @Length(0, 256)
  caption?: string;
}

/**
 * Phase 11 (post-Phase-10 feature) — Pre-ship "proof of dispatch" photos.
 *
 * Seller workflow:
 *   1. Pack the order, take 1-5 photos showing the packaged item +
 *      visible serial number / size / colour.
 *   2. Upload each photo via POST .../shipment-evidence
 *   3. Mark the order shipped.
 *
 * Admin workflow:
 *   When a customer files a return, the admin returns detail page
 *   surfaces these photos as the "as-shipped baseline". The admin can
 *   compare them against the customer's claim photos to spot
 *   "damaged in transit" frauds before paying for a courier pickup.
 *
 * Ownership:
 *   Seller can only upload + read shipment evidence for sub-orders
 *   they own (subOrder.sellerId === req.sellerId). The check is
 *   enforced inside this controller — files are stored against
 *   resource='sub_order' so the polymorphic FileAttachment table
 *   carries the link.
 */
@ApiTags('Seller Shipment Evidence')
@Controller('seller/sub-orders/:subOrderId/shipment-evidence')
@UseGuards(SellerAuthGuard)
export class SellerShipmentEvidenceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
    // Phase 88 — typed-evidence orchestrator. Dual-write: keep
    // FileAttachment for the legacy reader fallback, write
    // ShipmentEvidence for the typed-path consumers.
    private readonly shipmentEvidence: ShipmentEvidenceService,
  ) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
  ) {
    await this.assertOwnership(subOrderId, req.sellerId);

    // Phase 88 — read from the typed table. PACKING + DISPATCH +
    // EXCEPTION + ADMIN_OVERRIDE kinds are seller-visible; POD is
    // surfaced separately via the customer flow.
    const rows = await this.shipmentEvidence.listForSubOrder(subOrderId, {
      kinds: [
        'PACKING',
        'DISPATCH',
        'EXCEPTION',
        'ADMIN_OVERRIDE',
        'ARCHIVED_REASSIGNMENT',
      ],
    });
    const data = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      capturedAt: r.capturedAt,
      uploadedBy: r.uploadedBy,
      uploadedByRole: r.uploadedByRole,
      frozenAt: r.frozenAt,
      file: r.file,
      viewUrl: this.fileService.viewUrlFor(r.file),
    }));
    return { success: true, message: 'Shipment evidence retrieved', data };
  }

  // Phase 88 — Gap #7 idempotency. Honors the X-Idempotency-Key
  // header (and a fallback derived from the file SHA256 inside the
  // service) so a network retry creates one row, not two.
  @Post()
  @Idempotent()
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadEvidenceFormDto })
  async upload(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer) {
      throw new BadRequestAppException(
        'Image file required (multipart field name "image")',
      );
    }
    await this.assertOwnership(subOrderId, req.sellerId);

    const meta = await this.fileService.uploadDirect({
      purpose: 'SHIPMENT_EVIDENCE',
      file,
      uploadedBy: req.sellerId,
    });

    // Dual write — legacy FileAttachment for back-compat + new typed
    // ShipmentEvidence row for the gate count + audit trail.
    await this.fileService.attach({
      fileId: meta.id,
      resource: 'sub_order',
      resourceId: subOrderId,
      caption: 'Pre-ship dispatch photo',
      attachedBy: req.sellerId,
    });

    const { id: evidenceId } = await this.shipmentEvidence.create({
      subOrderId,
      kind: 'PACKING',
      fileId: meta.id,
      uploadedBy: req.sellerId,
      uploadedByRole: 'SELLER',
      contentSha256: meta.contentSha256 ?? null,
    });

    await this.shipmentEvidence.auditLog({
      shipmentEvidenceId: evidenceId,
      action: 'CREATED',
      actorId: req.sellerId,
      actorRole: 'SELLER',
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
      afterJson: { fileId: meta.id, kind: 'PACKING' },
    });

    return {
      success: true,
      message: 'Shipment evidence uploaded',
      data: { ...meta, evidenceId },
    };
  }

  /**
   * Phase 88 — Gap #13 soft-delete with freeze enforcement. Seller
   * cannot delete frozen rows (sub-order already SHIPPED); admin
   * override + reason required for post-SHIPPED edits.
   */
  @Delete(':evidenceId')
  async delete(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: DeleteEvidenceDto,
  ) {
    await this.assertOwnership(subOrderId, req.sellerId);
    await this.shipmentEvidence.softDelete({
      evidenceId,
      actorId: req.sellerId,
      actorRole: 'SELLER',
      reason: body.reason,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    return { success: true, message: 'Evidence deleted' };
  }

  /**
   * Confirm the sub-order belongs to the authenticated seller. Throws
   * 404 / 403 with intentionally-distinct messages so the admin
   * console can tell apart "doesn't exist" from "exists but not yours"
   * during incident reviews; the customer never hits this endpoint so
   * the leak surface is bounded.
   */
  private async assertOwnership(
    subOrderId: string,
    sellerId: string,
  ): Promise<void> {
    const so = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, sellerId: true },
    });
    if (!so) throw new NotFoundAppException('Sub-order not found');
    if (so.sellerId !== sellerId) {
      throw new ForbiddenAppException(
        'Cannot manage shipment evidence for a sub-order you do not own',
      );
    }
  }
}
