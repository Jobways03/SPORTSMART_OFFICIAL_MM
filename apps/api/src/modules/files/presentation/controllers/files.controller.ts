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
import { Throttle } from '@nestjs/throttler';
import type { FilePurpose } from '@prisma/client';
import { Request } from 'express';
import {
  AdminAuthGuard,
  AnyAuthGuard,
  PermissionsGuard,
  UserAuthGuard,
} from '../../../../core/guards';
import { Permissions } from '../../../../core/decorators/permissions.decorator';
import {
  BadRequestAppException,
  ForbiddenAppException,
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
  // Phase 250 (#8) — tighter per-caller cap than the global 300/min so a
  // single actor can't stream 50 MB × N at provider-billing pace.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT_BYTES } }))
  async uploadDirect(
    @Req() req: any,
    @Query('purpose') purpose: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestAppException('file is required (multipart field name "file")');
    if (!purpose) throw new BadRequestAppException('purpose query param is required');
    const caller = requesterContext(req);
    const data = await this.service.uploadDirect({
      purpose: purpose.toUpperCase() as FilePurpose,
      file,
      uploadedBy: caller.actorId,
      uploadedByType: caller.actorType,
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
    const caller = requesterContext(req);
    const data = await this.service.createUploadIntent({
      ...body,
      uploadedBy: caller.actorId,
      uploadedByType: caller.actorType,
    });
    return { success: true, message: 'Upload intent issued', data };
  }

  @Patch(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Req() req: any, @Param('id') id: string) {
    const data = await this.service.confirmUpload({
      fileId: id,
      uploadedBy: requesterContext(req).actorId,
    });
    return { success: true, message: 'Upload confirmed', data };
  }

  @Get(':id')
  async getMetadata(@Req() req: any, @Param('id') id: string) {
    // Phase 252 (#14) — metadata includes provider ids; gate it like the
    // URL: owner or admin only (the row is otherwise an enumeration oracle).
    const caller = requesterContext(req);
    const data = await this.service.findByIdForCaller(id, caller);
    return { success: true, message: 'File retrieved', data };
  }

  @Get(':id/secure-url')
  async getSecureUrl(@Req() req: any, @Param('id') id: string) {
    // Phase 252 (#14) — close the IDOR: the caller must own the file (or be
    // admin) for PRIVATE files. Previously any authed actor with a fileId
    // could fetch anyone's KYC/evidence URL.
    const url = await this.service.getSecureUrl(id, requesterContext(req));
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
    const caller = requesterContext(req);
    const data = await this.service.attach({
      fileId: id,
      resource: body.resource,
      resourceId: body.resourceId,
      caption: body.caption,
      attachedBy: caller.actorId,
      attachedByIsAdmin: caller.isAdmin,
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
    // Phase 250 — isAdmin was `!!req.adminId`, which AnyAuthGuard never sets,
    // so the admin-override branch never fired AND (combined with the
    // requesterId='unknown' bug) every actor could delete every file. Derive
    // from the resolved persona instead.
    const caller = requesterContext(req);
    const data = await this.service.softDelete(id, caller.actorId, caller.isAdmin);
    return { success: true, message: 'File deleted', data };
  }
}

/**
 * Admin moderation surface — list/search across all files in the platform
 * plus per-file detail with the full attachment graph. Distinct from the
 * customer-facing FilesController above, which scopes everything to the
 * caller's own files.
 *
 * Sprint 2 (Story 1.2) rewrite: previous version reached into the
 * service's private PrismaService via `as any`. Now goes through
 * proper FileService methods (`listForAdmin`, `findByIdForAdmin`) so
 * authorisation + invariants live in one place.
 */
@ApiTags('Files — Admin')
@Controller('admin/files')
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminFilesController {
  constructor(private readonly service: FileService) {}

  // Phase 250 — this surface reads ANY user's files (incl. KYC) and had
  // PermissionsGuard but no @Permissions (= open to any admin). Gate it.
  @Get()
  @Permissions('files.read.any')
  async list(
    @Query('purpose') purpose?: string,
    @Query('uploadedBy') uploadedBy?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.listForAdmin({
      purpose: purpose ? (purpose.toUpperCase() as FilePurpose) : undefined,
      uploadedBy: uploadedBy?.trim() || undefined,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      includeDeleted: includeDeleted === 'true',
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { success: true, message: 'Files retrieved', data };
  }

  /**
   * Admin detail — file metadata + every attachment so the moderator
   * can decide whether deleting the file would orphan a return, a
   * ticket, a KYC record, etc.
   */
  @Get(':id')
  @Permissions('files.read.any')
  async getOne(@Param('id') id: string) {
    const data = await this.service.findByIdForAdmin(id);
    return { success: true, message: 'File retrieved', data };
  }
}

export interface FileCaller {
  actorId: string;
  actorType: string | null;
  isAdmin: boolean;
}

/**
 * Phase 250 — resolve the caller from what AnyAuthGuard actually sets
 * (req.authActorId + req.user.{id,type}). The previous helper read
 * req.userId/adminId/sellerId/... — none of which AnyAuthGuard populates —
 * so it ALWAYS returned the literal 'unknown', collapsing every ownership
 * check (`uploadedBy === requester`) to 'unknown' === 'unknown'. Throw
 * rather than fall back to a shared sentinel.
 */
function requesterContext(req: any): FileCaller {
  const actorId: string | undefined = req.authActorId ?? req.user?.id;
  if (!actorId) {
    throw new ForbiddenAppException('Cannot identify caller');
  }
  const actorType: string | null = req.user?.type ?? null;
  return { actorId, actorType, isAdmin: actorType === 'ADMIN' };
}

// Bind UserAuthGuard import to keep tree-shaker honest (it's a peer
// guard recognised by AnyAuthGuard's resolution).
void UserAuthGuard;
