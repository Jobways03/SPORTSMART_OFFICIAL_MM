import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class ProductSlugService {
  constructor(private readonly prisma: PrismaService) {}

  async generateUniqueSlug(title: string): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    // Check if base slug is available
    const existing = await this.prisma.product.findUnique({
      where: { slug: baseSlug },
      select: { id: true },
    });

    if (!existing) {
      return baseSlug;
    }

    // Find the next available suffix
    let suffix = 2;
    while (true) {
      const candidateSlug = `${baseSlug}-${suffix}`;
      const collision = await this.prisma.product.findUnique({
        where: { slug: candidateSlug },
        select: { id: true },
      });

      if (!collision) {
        return candidateSlug;
      }

      suffix++;
    }
  }
}
