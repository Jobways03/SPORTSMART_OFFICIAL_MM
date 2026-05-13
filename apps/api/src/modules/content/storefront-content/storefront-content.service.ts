import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { CloudinaryAdapter } from '../../../integrations/cloudinary/cloudinary.adapter';

export interface StorefrontContentBlockDto {
  slot: string;
  imageUrl: string | null;
  eyebrow: string | null;
  headline: string | null;
  subhead: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  price: string | null;
  priceCaption: string | null;
  active: boolean;
  updatedAt: Date;
}

export interface UpsertStorefrontContentInput {
  imageUrl?: string | null;
  eyebrow?: string | null;
  headline?: string | null;
  subhead?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  price?: string | null;
  priceCaption?: string | null;
  active?: boolean;
}

@Injectable()
export class StorefrontContentService {
  private readonly logger = new Logger(StorefrontContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryAdapter,
  ) {}

  /**
   * Admin: list every row, active or not. Sorted by slot for stable
   * paging in the admin grid.
   */
  async listAll(): Promise<StorefrontContentBlockDto[]> {
    const rows = await this.prisma.storefrontContentBlock.findMany({
      orderBy: { slot: 'asc' },
    });
    return rows.map(this.toDto);
  }

  /**
   * Public: returns a slot → block map for every ACTIVE row. The
   * storefront homepage fetches this once per request (or per ISR
   * window) and threads the map into MediaTile via imageSrc.
   */
  async listActiveAsMap(): Promise<Record<string, StorefrontContentBlockDto>> {
    const rows = await this.prisma.storefrontContentBlock.findMany({
      where: { active: true },
    });
    const out: Record<string, StorefrontContentBlockDto> = {};
    for (const r of rows) out[r.slot] = this.toDto(r);
    return out;
  }

  async findBySlot(slot: string): Promise<StorefrontContentBlockDto | null> {
    const row = await this.prisma.storefrontContentBlock.findUnique({
      where: { slot },
    });
    return row ? this.toDto(row) : null;
  }

  /**
   * Upsert the block for a slot. Caller (controller) supplies the
   * actor id so we record who last touched the row — useful in the
   * audit-log timeline for compliance.
   */
  async upsert(
    slot: string,
    input: UpsertStorefrontContentInput,
    updatedById?: string,
  ): Promise<StorefrontContentBlockDto> {
    const row = await this.prisma.storefrontContentBlock.upsert({
      where: { slot },
      create: {
        slot,
        imageUrl: input.imageUrl ?? null,
        eyebrow: input.eyebrow ?? null,
        headline: input.headline ?? null,
        subhead: input.subhead ?? null,
        ctaLabel: input.ctaLabel ?? null,
        ctaHref: input.ctaHref ?? null,
        price: input.price ?? null,
        priceCaption: input.priceCaption ?? null,
        active: input.active ?? true,
        updatedById: updatedById ?? null,
      },
      update: {
        // Use `undefined` to leave a field untouched. Tests rely on
        // this: passing only headline shouldn't blank the image.
        imageUrl: input.imageUrl === undefined ? undefined : input.imageUrl,
        eyebrow: input.eyebrow === undefined ? undefined : input.eyebrow,
        headline: input.headline === undefined ? undefined : input.headline,
        subhead: input.subhead === undefined ? undefined : input.subhead,
        ctaLabel: input.ctaLabel === undefined ? undefined : input.ctaLabel,
        ctaHref: input.ctaHref === undefined ? undefined : input.ctaHref,
        price: input.price === undefined ? undefined : input.price,
        priceCaption:
          input.priceCaption === undefined ? undefined : input.priceCaption,
        active: input.active === undefined ? undefined : input.active,
        updatedById: updatedById ?? null,
      },
    });
    return this.toDto(row);
  }

  /**
   * Reset a slot to the storefront's fallback (the curated Unsplash
   * image in MediaTile). Deletes the row so the public map no longer
   * carries it; the storefront's MediaTile fallback then fires.
   */
  async resetSlot(slot: string): Promise<void> {
    await this.prisma.storefrontContentBlock
      .delete({ where: { slot } })
      .catch((err) => {
        // P2025 = row not found; treat as idempotent (already reset).
        if ((err as { code?: string })?.code !== 'P2025') throw err;
      });
  }

  /**
   * Upload an image to Cloudinary and persist the URL on the block for
   * `slot`. Returns the updated row so the admin UI can refresh in one
   * round-trip.
   *
   * Single source of truth: this method both uploads AND writes the
   * row. The controller doesn't need to call upsert separately.
   */
  async uploadImage(
    slot: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    updatedById?: string,
  ): Promise<StorefrontContentBlockDto> {
    const result = await this.cloudinary.upload(file.buffer, {
      folder: `storefront-content/${slot}`,
      resourceType: 'image',
    });
    this.logger.log(
      `Storefront content image uploaded for slot=${slot} url=${result.secureUrl}`,
    );
    return this.upsert(slot, { imageUrl: result.secureUrl }, updatedById);
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private toDto(row: {
    slot: string;
    imageUrl: string | null;
    eyebrow: string | null;
    headline: string | null;
    subhead: string | null;
    ctaLabel: string | null;
    ctaHref: string | null;
    price: string | null;
    priceCaption: string | null;
    active: boolean;
    updatedAt: Date;
  }): StorefrontContentBlockDto {
    return {
      slot: row.slot,
      imageUrl: row.imageUrl,
      eyebrow: row.eyebrow,
      headline: row.headline,
      subhead: row.subhead,
      ctaLabel: row.ctaLabel,
      ctaHref: row.ctaHref,
      price: row.price,
      priceCaption: row.priceCaption,
      active: row.active,
      updatedAt: row.updatedAt,
    };
  }
}
