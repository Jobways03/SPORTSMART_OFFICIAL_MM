import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { SellerAuthGuard } from '../../../../core/guards';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { FileService } from '../../../files/application/services/file.service';

const UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024;

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
  ) {}

  @Get()
  async list(
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
  ) {
    await this.assertOwnership(subOrderId, req.sellerId);
    const attachments = await this.fileService.listByResource(
      'sub_order',
      subOrderId,
    );
    // PRIVATE files (SHIPMENT_EVIDENCE) have providerUrl=null in the DB.
    // Derive a viewable Cloudinary URL per item so the seller portal
    // can render `<img>` thumbnails and open in a new tab without an
    // auth round-trip. Privacy contract is preserved: the caller has
    // already passed SellerAuthGuard + ownership check above.
    const data = attachments.map((att) => ({
      ...att,
      viewUrl: this.fileService.viewUrlFor(att.file),
    }));
    return { success: true, message: 'Shipment evidence retrieved', data };
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }),
  )
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

    await this.fileService.attach({
      fileId: meta.id,
      resource: 'sub_order',
      resourceId: subOrderId,
      caption: 'Pre-ship dispatch photo',
      attachedBy: req.sellerId,
    });

    return { success: true, message: 'Shipment evidence uploaded', data: meta };
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
