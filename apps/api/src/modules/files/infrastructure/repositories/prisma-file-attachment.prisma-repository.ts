import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class PrismaFileAttachmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(data: { fileId: string; resource: string; resourceId: string }) {
    return this.prisma.fileAttachment.create({ data });
  }

  async findByResource(resource: string, resourceId: string) {
    return this.prisma.fileAttachment.findMany({
      where: { resource, resourceId },
      include: { file: true },
    });
  }
}
