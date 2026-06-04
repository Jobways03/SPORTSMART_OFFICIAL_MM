import { Global, Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  AffiliateAuthGuard,
  AnyAuthGuard,
  FranchiseAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { MediaStorageAdapter } from '../../integrations/media/media-storage.adapter';
import { FilesPublicFacade } from './application/facades/files-public.facade';
import { FileService } from './application/services/file.service';
import { PrismaFileMetadataRepository } from './infrastructure/repositories/prisma-file-metadata.prisma-repository';
import { PrismaFileAttachmentRepository } from './infrastructure/repositories/prisma-file-attachment.prisma-repository';
import {
  AdminFilesController,
  FilesController,
} from './presentation/controllers/files.controller';

// Global so any module can inject FileService for attaching files
// (disputes, support, KYC, invoices) without re-importing FilesModule.
@Global()
@Module({
  controllers: [FilesController, AdminFilesController],
  providers: [
    // Auth guards used by AnyAuthGuard's resolver — must be available
    // in the same DI scope as the controller.
    AdminAuthGuard,
    UserAuthGuard,
    SellerAuthGuard,
    FranchiseAuthGuard,
    AffiliateAuthGuard,
    AnyAuthGuard,

    // Storage adapters. MediaStorageAdapter is local; R2Client/R2Adapter come
    // from the @Global R2Module (replaces the former local S3 providers).
    MediaStorageAdapter,

    // Services
    FileService,
    FilesPublicFacade,

    // Repos (legacy facade still uses these)
    PrismaFileMetadataRepository,
    PrismaFileAttachmentRepository,
  ],
  // Phase 253 — export MediaStorageAdapter so the (also @Global) retention
  // enforcer can issue real provider deletes on erasure.
  exports: [FileService, FilesPublicFacade, MediaStorageAdapter],
})
export class FilesModule {}
