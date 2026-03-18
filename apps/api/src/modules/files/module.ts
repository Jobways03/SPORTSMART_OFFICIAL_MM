import { Module } from '@nestjs/common';
import { FilesPublicFacade } from './application/facades/files-public.facade';
import { PrismaFileMetadataRepository } from './infrastructure/repositories/prisma-file-metadata.prisma-repository';
import { PrismaFileAttachmentRepository } from './infrastructure/repositories/prisma-file-attachment.prisma-repository';

@Module({
  providers: [
    FilesPublicFacade,
    PrismaFileMetadataRepository,
    PrismaFileAttachmentRepository,
  ],
  exports: [FilesPublicFacade],
})
export class FilesModule {}
