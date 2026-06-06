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
import { FranchiseAuthGuard } from '../../../../core/guards';
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

export class DeleteEvidenceDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class UploadEvidenceFormDto {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image!: any;

  @IsOptional()
  @IsString()
  @Length(0, 256)
  caption?: string;
}

/**
 * Franchise counterpart of SellerShipmentEvidenceController — pre-ship
 * "proof of dispatch" photos for FRANCHISE-fulfilled sub-orders.
 *
 * Mirrors the seller surface 1:1 (same FileService dual-write +
 * ShipmentEvidence typed row + audit trail) so the franchise PACK/SHIP
 * photo gate can be enforced symmetrically with sellers. Before this
 * existed the franchise portal had no upload surface at all, so the gate
 * was hard-scoped to SELLER and franchises were never asked for photos.
 *
 * Ownership:
 *   A franchise can only upload + read shipment evidence for sub-orders
 *   it owns (subOrder.franchiseId === req.franchiseId AND
 *   fulfillmentNodeType === 'FRANCHISE'). Files are stored against
 *   resource='sub_order' on the polymorphic FileAttachment table.
 */
@ApiTags('Franchise Shipment Evidence')
@Controller('franchise/sub-orders/:subOrderId/shipment-evidence')
@UseGuards(FranchiseAuthGuard)
export class FranchiseShipmentEvidenceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileService: FileService,
    private readonly shipmentEvidence: ShipmentEvidenceService,
  ) {}

  @Get()
  async list(@Req() req: any, @Param('subOrderId') subOrderId: string) {
    await this.assertOwnership(subOrderId, req.franchiseId);

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
    await this.assertOwnership(subOrderId, req.franchiseId);

    const meta = await this.fileService.uploadDirect({
      purpose: 'SHIPMENT_EVIDENCE',
      file,
      uploadedBy: req.franchiseId,
    });

    await this.fileService.attach({
      fileId: meta.id,
      resource: 'sub_order',
      resourceId: subOrderId,
      caption: 'Pre-ship dispatch photo',
      attachedBy: req.franchiseId,
    });

    const { id: evidenceId } = await this.shipmentEvidence.create({
      subOrderId,
      kind: 'PACKING',
      fileId: meta.id,
      uploadedBy: req.franchiseId,
      uploadedByRole: 'FRANCHISE',
      contentSha256: meta.contentSha256 ?? null,
    });

    await this.shipmentEvidence.auditLog({
      shipmentEvidenceId: evidenceId,
      action: 'CREATED',
      actorId: req.franchiseId,
      actorRole: 'FRANCHISE',
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

  @Delete(':evidenceId')
  async delete(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: DeleteEvidenceDto,
  ) {
    await this.assertOwnership(subOrderId, req.franchiseId);
    await this.shipmentEvidence.softDelete({
      evidenceId,
      actorId: req.franchiseId,
      actorRole: 'FRANCHISE',
      reason: body.reason,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    return { success: true, message: 'Evidence deleted' };
  }

  /**
   * Confirm the sub-order belongs to the authenticated franchise AND is a
   * FRANCHISE-fulfilled node. Distinct 404/403 so the admin console can
   * tell apart "doesn't exist" from "exists but not yours".
   */
  private async assertOwnership(
    subOrderId: string,
    franchiseId: string,
  ): Promise<void> {
    const so = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: { id: true, franchiseId: true, fulfillmentNodeType: true },
    });
    if (!so) throw new NotFoundAppException('Sub-order not found');
    if (so.fulfillmentNodeType !== 'FRANCHISE' || so.franchiseId !== franchiseId) {
      throw new ForbiddenAppException(
        'Cannot manage shipment evidence for a sub-order you do not own',
      );
    }
  }
}
