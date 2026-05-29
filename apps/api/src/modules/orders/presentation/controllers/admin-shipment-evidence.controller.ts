// Phase 88 (2026-05-23) — Shipment Evidence Flow Gap #15.
//
// Pre-Phase-88 only one @Permissions('returns.read') gated everything;
// any admin who could read returns could view + soft-delete shipment
// evidence regardless of seniority. Phase 88 splits into three tiers:
//   shipment.evidence.read   (support tier)
//   shipment.evidence.write  (ops — admin override upload)
//   shipment.evidence.delete (senior-ops — soft-delete + bypass freeze)

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
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

import { AdminAuthGuard, PermissionsGuard } from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CurrentAdmin } from '../../../../core/decorators/current-actor.decorator';
import { BadRequestAppException } from '../../../../core/exceptions';
import { FileService } from '../../../files/application/services/file.service';
import { ShipmentEvidenceService } from '../../../shipping/application/services/shipment-evidence.service';

const UPLOAD_LIMIT_BYTES = 8 * 1024 * 1024;

export class AdminDeleteEvidenceDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class AdminOverrideUploadDto {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image!: any;

  @IsOptional()
  @IsString()
  @Length(0, 256)
  caption?: string;

  @IsString()
  @Length(10, 500)
  reason!: string;
}

@ApiTags('Admin Shipment Evidence')
@Controller('admin/sub-orders/:subOrderId/shipment-evidence')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminShipmentEvidenceController {
  constructor(
    private readonly fileService: FileService,
    private readonly shipmentEvidence: ShipmentEvidenceService,
  ) {}

  /**
   * Tier 1 (support) — read shipment evidence. Returns ALL kinds
   * (PACKING + POD + RTO_PROOF + ARCHIVED_REASSIGNMENT + audit).
   */
  @Get()
  @Permissions('shipment.evidence.read')
  async list(@Param('subOrderId') subOrderId: string) {
    const rows = await this.shipmentEvidence.listForSubOrder(subOrderId, {
      includeDeleted: false,
    });
    const data = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      capturedAt: r.capturedAt,
      uploadedBy: r.uploadedBy,
      uploadedByRole: r.uploadedByRole,
      geoLat: r.geoLat,
      geoLng: r.geoLng,
      courierWaybill: r.courierWaybill,
      signedByName: r.signedByName,
      frozenAt: r.frozenAt,
      file: r.file,
      viewUrl: this.fileService.viewUrlFor(r.file),
    }));
    return { success: true, message: 'Shipment evidence retrieved', data };
  }

  /**
   * Tier 2 (ops) — admin override upload. Writes a kind=ADMIN_OVERRIDE
   * row tied to the requesting admin with an audit reason. Used when
   * the seller can't access the portal but evidence needs to be on
   * file (e.g. dispute investigation, internal QC).
   */
  @Post('override')
  @Permissions('shipment.evidence.write')
  @Idempotent()
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: AdminOverrideUploadDto })
  async overrideUpload(
    @CurrentAdmin() adminId: string,
    @Req() req: any,
    @Param('subOrderId') subOrderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: AdminOverrideUploadDto,
  ) {
    if (!file?.buffer) {
      throw new BadRequestAppException(
        'Image file required (multipart field name "image")',
      );
    }
    const meta = await this.fileService.uploadDirect({
      purpose: 'SHIPMENT_EVIDENCE',
      file,
      uploadedBy: adminId,
    });
    await this.fileService.attach({
      fileId: meta.id,
      resource: 'sub_order',
      resourceId: subOrderId,
      caption: body.caption ?? 'Admin override',
      attachedBy: adminId,
    });
    const { id } = await this.shipmentEvidence.create({
      subOrderId,
      kind: 'ADMIN_OVERRIDE',
      fileId: meta.id,
      uploadedBy: adminId,
      uploadedByRole: 'ADMIN',
      contentSha256: meta.contentSha256 ?? null,
    });
    await this.shipmentEvidence.auditLog({
      shipmentEvidenceId: id,
      action: 'CREATED',
      actorId: adminId,
      actorRole: 'ADMIN',
      reason: body.reason,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
      afterJson: { fileId: meta.id, kind: 'ADMIN_OVERRIDE' },
    });
    return {
      success: true,
      message: 'Admin override evidence uploaded',
      data: { ...meta, evidenceId: id },
    };
  }

  /**
   * Tier 3 (senior-ops) — soft-delete bypasses the post-SHIPPED freeze.
   * Reason ≥ 10 chars required (Gap #5 chain-of-custody).
   */
  @Delete(':evidenceId')
  @Permissions('shipment.evidence.delete')
  async delete(
    @CurrentAdmin() adminId: string,
    @Req() req: any,
    @Param('evidenceId') evidenceId: string,
    @Body() body: AdminDeleteEvidenceDto,
  ) {
    await this.shipmentEvidence.softDelete({
      evidenceId,
      actorId: adminId,
      actorRole: 'ADMIN',
      reason: body.reason,
      bypassFreeze: true,
      ipAddress: req.ip ?? null,
      userAgent: req.headers?.['user-agent'] ?? null,
    });
    return { success: true, message: 'Evidence deleted' };
  }
}
