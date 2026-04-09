import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
// NOTE: DuplicateDetectionService uses complex Prisma queries that are tightly coupled
// to the search algorithm. It retains PrismaService directly for pragmatic reasons.

export interface PotentialDuplicate {
  productId: string;
  productCode: string;
  title: string;
  brandName: string | null;
  categoryName: string | null;
  primaryImageUrl: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchReason: string;
}

@Injectable()
export class DuplicateDetectionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Normalize a title: lowercase, remove special characters, collapse whitespace
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract significant words from a title (skip common stop words)
   */
  private getSignificantWords(title: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'are', 'was',
      'be', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'not', 'no', 'so', 'if', 'as',
    ]);
    const normalized = this.normalizeTitle(title);
    return normalized.split(' ').filter(w => w.length > 1 && !stopWords.has(w));
  }

  /**
   * Calculate word overlap ratio between two sets of words
   */
  private calculateWordOverlap(words1: string[], words2: string[]): number {
    if (words1.length === 0 || words2.length === 0) return 0;
    const set2 = new Set(words2);
    const matches = words1.filter(w => set2.has(w)).length;
    const minLen = Math.min(words1.length, words2.length);
    return matches / minLen;
  }

  async findPotentialDuplicates(input: {
    title: string;
    brandId?: string;
    categoryId?: string;
  }): Promise<PotentialDuplicate[]> {
    const significantWords = this.getSignificantWords(input.title);
    if (significantWords.length === 0) {
      return [];
    }

    // Use the first 3 significant words as search keys
    const searchWords = significantWords.slice(0, 3);

    // Build AND conditions: each search word must appear in the title
    const searchConditions = searchWords.map(word => ({
      title: { contains: word, mode: 'insensitive' as const },
    }));

    // Query existing ACTIVE/APPROVED products with similar title
    const candidates = await this.prisma.product.findMany({
      where: {
        AND: searchConditions,
        isDeleted: false,
        OR: [
          { status: 'ACTIVE' },
          { moderationStatus: 'APPROVED' },
        ],
      },
      include: {
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      },
      take: 20, // Fetch more than needed so we can score and rank
    });

    if (candidates.length === 0) {
      return [];
    }

    // Score each candidate
    const scored: (PotentialDuplicate & { score: number })[] = [];

    for (const candidate of candidates) {
      const candidateWords = this.getSignificantWords(candidate.title);
      const wordOverlap = this.calculateWordOverlap(significantWords, candidateWords);

      // Skip if less than 50% word overlap
      if (wordOverlap < 0.5) continue;

      let score = wordOverlap * 50; // Base score from title similarity (0-50)
      const reasons: string[] = [];

      // Title match component
      if (wordOverlap >= 0.8) {
        reasons.push('Title match');
      } else {
        reasons.push('Partial title match');
      }

      // Brand match boost
      const brandMatch = input.brandId && candidate.brandId === input.brandId;
      if (brandMatch) {
        score += 25;
        reasons.push('Brand');
      }

      // Category match boost
      const categoryMatch = input.categoryId && candidate.categoryId === input.categoryId;
      if (categoryMatch) {
        score += 25;
        reasons.push('Category');
      }

      // Determine confidence level
      let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      if (brandMatch && categoryMatch && wordOverlap >= 0.7) {
        confidence = 'HIGH';
      } else if ((brandMatch || categoryMatch) && wordOverlap >= 0.6) {
        confidence = 'MEDIUM';
      } else {
        confidence = 'LOW';
      }

      const matchReason = reasons.join(' + ') + ' match';

      scored.push({
        productId: candidate.id,
        productCode: candidate.productCode || '',
        title: candidate.title,
        brandName: candidate.brand?.name ?? null,
        categoryName: candidate.category?.name ?? null,
        primaryImageUrl: (candidate.images as any[])?.[0]?.url ?? null,
        confidence,
        matchReason,
        score,
      });
    }

    // Sort by score descending and take top 5
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(({ score, ...rest }) => rest);
  }
}
