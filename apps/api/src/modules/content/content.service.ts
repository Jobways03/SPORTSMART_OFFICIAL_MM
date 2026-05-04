import { Injectable } from '@nestjs/common';
import type { BannerSlot } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../core/exceptions';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Banners ─────────────────────────────────────────────────────

  async listBannersForSlot(slot: BannerSlot, scopeId?: string) {
    const now = new Date();
    return this.prisma.banner.findMany({
      where: {
        slot,
        active: true,
        ...(scopeId ? { scopeId } : {}),
        OR: [
          { startsAt: null, endsAt: null },
          { startsAt: { lte: now }, endsAt: null },
          { startsAt: null, endsAt: { gte: now } },
          { startsAt: { lte: now }, endsAt: { gte: now } },
        ],
      },
      orderBy: { position: 'asc' },
    });
  }

  listAllBanners() {
    return this.prisma.banner.findMany({ orderBy: [{ slot: 'asc' }, { position: 'asc' }] });
  }
  createBanner(data: any) { return this.prisma.banner.create({ data }); }
  updateBanner(id: string, data: any) { return this.prisma.banner.update({ where: { id }, data }); }
  deleteBanner(id: string) { return this.prisma.banner.delete({ where: { id } }); }

  // ── Static pages ───────────────────────────────────────────────

  listPages() { return this.prisma.staticPage.findMany({ orderBy: { slug: 'asc' } }); }
  async getPageBySlug(slug: string) {
    const page = await this.prisma.staticPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundAppException('Page not found');
    return page;
  }
  upsertPage(slug: string, data: any) {
    return this.prisma.staticPage.upsert({
      where: { slug },
      create: { slug, ...data },
      update: data,
    });
  }
  deletePage(slug: string) { return this.prisma.staticPage.delete({ where: { slug } }); }

  // ── FAQ ─────────────────────────────────────────────────────────

  listFaq(category?: string) {
    return this.prisma.faqEntry.findMany({
      where: { active: true, ...(category ? { category } : {}) },
      orderBy: [{ category: 'asc' }, { position: 'asc' }],
    });
  }
  createFaq(data: any) { return this.prisma.faqEntry.create({ data }); }
  updateFaq(id: string, data: any) { return this.prisma.faqEntry.update({ where: { id }, data }); }
  deleteFaq(id: string) { return this.prisma.faqEntry.delete({ where: { id } }); }
}
