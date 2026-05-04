import { Global, Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  AffiliateAuthGuard,
  AnyAuthGuard,
  FranchiseAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { S3Adapter } from '../../integrations/s3/adapters/s3.adapter';
import { S3Client } from '../../integrations/s3/clients/s3.client';
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

    // Storage adapters
    CloudinaryAdapter,
    S3Client,
    S3Adapter,

    // Services
    FileService,
    FilesPublicFacade,

    // Repos (legacy facade still uses these)
    PrismaFileMetadataRepository,
    PrismaFileAttachmentRepository,
  ],
  exports: [FileService, FilesPublicFacade],
})
export class FilesModule {}
