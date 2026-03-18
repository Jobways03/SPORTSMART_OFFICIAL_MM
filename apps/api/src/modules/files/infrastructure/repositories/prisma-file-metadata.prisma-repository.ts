import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class PrismaFileMetadataRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(data: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    classification: string;
    storageKey: string;
    uploadedBy: string;
  }) {
    return this.prisma.fileMetadata.create({ data: data as any });
  }

  async findById(id: string) {
    return this.prisma.fileMetadata.findUnique({ where: { id } });
  }

  async findByStorageKey(storageKey: string) {
    return this.prisma.fileMetadata.findUnique({ where: { storageKey } });
  }
}
