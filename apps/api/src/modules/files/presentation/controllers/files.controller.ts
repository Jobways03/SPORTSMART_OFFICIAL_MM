import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { FilePurpose } from '@prisma/client';
import { Request } from 'express';
import {
  AdminAuthGuard,
  AnyAuthGuard,
  PermissionsGuard,
  UserAuthGuard,
} from '../../../../core/guards';
import {
  BadRequestAppException,
} from '../../../../core/exceptions';
import { FileService } from '../../application/services/file.service';

const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024; // upper cap; per-purpose cap enforced in service

/**
 * Single controller for the file lifecycle. Mounted on /files; access
 * gated by AnyAuthGuard so customers/sellers/franchises/affiliates/admins
 * can all upload + manage the files they own. The service enforces the
 * "uploadedBy must match requester" rule on confirm/delete.
 */
@ApiTags('Files')
@Controller('files')
@UseGuards(AnyAuthGuard)
export class FilesController {
  constructor(private readonly service: FileService) {}

  /**
   * Direct upload (multipart). Returns a READY FileMetadata row.
   * Use this when the client can stream the file through the API.
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }))
  async uploadDirect(
    @Req() req: any,
    @Query('purpose') purpose: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestAppException('file is required (multipart field name "file")');
    if (!purpose) throw new BadRequestAppException('purpose query param is required');
    const data = await this.service.uploadDirect({
      purpose: purpose.toUpperCase() as FilePurpose,
      file,
      uploadedBy: requesterId(req),
    });
    return { success: true, message: 'File uploaded', data };
  }

  /**
   * Signed-URL upload-intent. Use when the client should upload directly
   * to S3 without proxying through us. Requires S3 to be configured.
   */
  @Post('upload-intent')
  @HttpCode(HttpStatus.CREATED)
  async createUploadIntent(
    @Req() req: any,
    @Body() body: {
      purpose: FilePurpose;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
    },
  ) {
    if (!body?.purpose || !body?.fileName || !body?.mimeType || !body?.sizeBytes) {
      throw new BadRequestAppException(
        'purpose, fileName, mimeType, sizeBytes are all required',
      );
    }
    const data = await this.service.createUploadIntent({
      ...body,
      uploadedBy: requesterId(req),
    });
    return { success: true, message: 'Upload intent issued', data };
  }

  @Patch(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.confirmUpload({
      fileId: id,
      uploadedBy: requesterId(req),
    });
    return { success: true, message: 'Upload confirmed', data };
  }

  @Get(':id')
  async getMetadata(@Param('id') id: string) {
    const data = await this.service.findById(id);
    return { success: true, message: 'File retrieved', data };
  }

  @Get(':id/secure-url')
  async getSecureUrl(@Param('id') id: string) {
    const url = await this.service.getSecureUrl(id);
    return { success: true, message: 'URL issued', data: { url, expiresInSeconds: 300 } };
  }

  @Post(':id/attach')
  @HttpCode(HttpStatus.CREATED)
  async attach(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { resource: string; resourceId: string; caption?: string },
  ) {
    if (!body?.resource || !body?.resourceId) {
      throw new BadRequestAppException('resource and resourceId are required');
    }
    const data = await this.service.attach({
      fileId: id,
      resource: body.resource,
      resourceId: body.resourceId,
      caption: body.caption,
      attachedBy: requesterId(req),
    });
    return { success: true, message: 'File attached', data };
  }

  @Get()
  async listByResource(
    @Query('resource') resource: string,
    @Query('resourceId') resourceId: string,
  ) {
    if (!resource || !resourceId) {
      throw new BadRequestAppException('resource + resourceId are required');
    }
    const data = await this.service.listByResource(resource, resourceId);
    return { success: true, message: 'Files retrieved', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async softDelete(@Req() req: any, @Param('id') id: string) {
    const isAdmin = !!req.adminId;
    const data = await this.service.softDelete(
      id,
      requesterId(req),
      isAdmin,
    );
    return { success: true, message: 'File deleted', data };
  }
}

/**
 * Admin-only listing across all files (debug + moderation surface).
 * Mounted separately so the AdminAuthGuard isolation is explicit.
 */
@ApiTags('Files — Admin')
@Controller('admin/files')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminFilesController {
  constructor(private readonly service: FileService) {}

  @Get()
  async list(
    @Query('purpose') purpose?: string,
    @Query('uploadedBy') uploadedBy?: string,
    @Query('limit') limit?: string,
  ) {
    // Reuse the service via the prisma client through findById is not
    // appropriate; we expose a thin one-off here for admin moderation.
    // Kept tiny — not paginated yet (defer to admin needs).
    const items = await (this.service as any).prisma.fileMetadata.findMany({
      where: {
        ...(purpose ? { purpose: purpose.toUpperCase() as FilePurpose } : {}),
        ...(uploadedBy ? { uploadedBy } : {}),
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit || '100', 10) || 100, 500),
    });
    return { success: true, message: 'Files retrieved', data: { items } };
  }
}

function requesterId(req: any): string {
  return (
    req.userId ??
    req.adminId ??
    req.sellerId ??
    req.franchiseId ??
    req.affiliateId ??
    'unknown'
  );
}

// Bind UserAuthGuard import to keep tree-shaker honest (it's a peer
// guard recognised by AnyAuthGuard's resolution).
void UserAuthGuard;
