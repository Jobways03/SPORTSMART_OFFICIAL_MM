import { Injectable } from '@nestjs/common';
import { PrismaFileMetadataRepository } from '../../infrastructure/repositories/prisma-file-metadata.prisma-repository';
import { PrismaFileAttachmentRepository } from '../../infrastructure/repositories/prisma-file-attachment.prisma-repository';

@Injectable()
export class FilesPublicFacade {
  constructor(
    private readonly fileMetadataRepo: PrismaFileMetadataRepository,
    private readonly fileAttachmentRepo: PrismaFileAttachmentRepository,
  ) {}

  async createUploadIntent(params: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    classification: string;
    uploadedBy: string;
  }): Promise<{ fileId: string; storageKey: string }> {
    const storageKey = `${params.classification}/${Date.now()}-${params.fileName}`;
    const file = await this.fileMetadataRepo.save({
      ...params,
      storageKey,
    });
    return { fileId: file.id, storageKey };
  }

  async attachFileToResource(params: {
    fileId: string;
    resource: string;
    resourceId: string;
  }): Promise<void> {
    await this.fileAttachmentRepo.save(params);
  }

  async getSecureFileAccess(fileId: string): Promise<{ fileName: string; storageKey: string } | null> {
    const file = await this.fileMetadataRepo.findById(fileId);
    if (!file) return null;
    return { fileName: file.fileName, storageKey: file.storageKey };
  }
}
