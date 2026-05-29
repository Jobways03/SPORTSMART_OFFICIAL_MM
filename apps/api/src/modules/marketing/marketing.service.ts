import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../../core/exceptions';

// ── FlashSale ──────────────────────────────────────────────────────────

export interface FlashSaleDto {
  id: string;
  title: string;
  subtitle: string | null;
  startsAt: string;
  endsAt: string;
  membersOnly: boolean;
  collectionSlug: string | null;
  waitlistCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFlashSaleInput {
  title: string;
  subtitle?: string;
  startsAt: string;
  endsAt: string;
  membersOnly?: boolean;
  collectionSlug?: string;
  waitlistCount?: number;
  isActive?: boolean;
}

export interface UpdateFlashSaleInput extends Partial<CreateFlashSaleInput> {}

// ── Event ──────────────────────────────────────────────────────────────

export interface SportEventDto {
  id: string;
  title: string;
  category: string;
  startsAt: string;
  endsAt: string | null;
  city: string | null;
  description: string | null;
  url: string | null;
  isMemberFree: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSportEventInput {
  title: string;
  category: string;
  startsAt: string;
  endsAt?: string;
  city?: string;
  description?: string;
  url?: string;
  isMemberFree?: boolean;
  isActive?: boolean;
}

export interface UpdateSportEventInput extends Partial<CreateSportEventInput> {}

@Injectable()
export class MarketingService {
  private readonly logger = new Logger(MarketingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── FlashSale ────────────────────────────────────────────────────────

  // Public: only campaigns currently within their window AND flagged
  // active. Order by endsAt ascending so the soonest-ending campaign
  // is the first one the storefront sees (mobile only uses [0]).
  async listActiveFlashSales(): Promise<FlashSaleDto[]> {
    const now = new Date();
    const rows = await this.prisma.flashSale.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'asc' },
    });
    return rows.map(this.toFlashSaleDto);
  }

  // Admin: every row, paginated. Default sort is "most recently
  // edited" so the marketing team's latest work bubbles up.
  async adminListFlashSales(params: { page: number; limit: number }): Promise<{
    items: FlashSaleDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit } = params;
    const [rows, total] = await Promise.all([
      this.prisma.flashSale.findMany({
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.flashSale.count(),
    ]);
    return { items: rows.map(this.toFlashSaleDto), total, page, limit };
  }

  async adminGetFlashSale(id: string): Promise<FlashSaleDto> {
    const row = await this.prisma.flashSale.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Flash sale not found');
    return this.toFlashSaleDto(row);
  }

  async createFlashSale(input: CreateFlashSaleInput): Promise<FlashSaleDto> {
    const row = await this.prisma.flashSale.create({
      data: {
        title: input.title,
        subtitle: input.subtitle ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        membersOnly: input.membersOnly ?? false,
        collectionSlug: input.collectionSlug ?? null,
        waitlistCount: input.waitlistCount ?? 0,
        isActive: input.isActive ?? true,
      },
    });
    return this.toFlashSaleDto(row);
  }

  async updateFlashSale(
    id: string,
    input: UpdateFlashSaleInput,
  ): Promise<FlashSaleDto> {
    await this.adminGetFlashSale(id); // 404 if missing
    const data: Prisma.FlashSaleUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.subtitle !== undefined) data.subtitle = input.subtitle;
    if (input.startsAt !== undefined) data.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined) data.endsAt = new Date(input.endsAt);
    if (input.membersOnly !== undefined) data.membersOnly = input.membersOnly;
    if (input.collectionSlug !== undefined)
      data.collectionSlug = input.collectionSlug;
    if (input.waitlistCount !== undefined)
      data.waitlistCount = input.waitlistCount;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const row = await this.prisma.flashSale.update({ where: { id }, data });
    return this.toFlashSaleDto(row);
  }

  async deleteFlashSale(id: string): Promise<void> {
    await this.adminGetFlashSale(id);
    await this.prisma.flashSale.delete({ where: { id } });
  }

  // ── SportEvent ──────────────────────────────────────────────────────

  // Public: upcoming + active, soonest first. We use startsAt > now()
  // so completed events drop off automatically — admin doesn't need
  // to remember to disable old rows.
  async listUpcomingEvents(): Promise<SportEventDto[]> {
    const now = new Date();
    const rows = await this.prisma.sportEvent.findMany({
      where: {
        isActive: true,
        startsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      take: 10,
    });
    return rows.map(this.toEventDto);
  }

  async adminListEvents(params: { page: number; limit: number }): Promise<{
    items: SportEventDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page, limit } = params;
    const [rows, total] = await Promise.all([
      this.prisma.sportEvent.findMany({
        orderBy: { startsAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sportEvent.count(),
    ]);
    return { items: rows.map(this.toEventDto), total, page, limit };
  }

  async adminGetEvent(id: string): Promise<SportEventDto> {
    const row = await this.prisma.sportEvent.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('Event not found');
    return this.toEventDto(row);
  }

  async createEvent(input: CreateSportEventInput): Promise<SportEventDto> {
    const row = await this.prisma.sportEvent.create({
      data: {
        title: input.title,
        category: input.category,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        city: input.city ?? null,
        description: input.description ?? null,
        url: input.url ?? null,
        isMemberFree: input.isMemberFree ?? false,
        isActive: input.isActive ?? true,
      },
    });
    return this.toEventDto(row);
  }

  async updateEvent(
    id: string,
    input: UpdateSportEventInput,
  ): Promise<SportEventDto> {
    await this.adminGetEvent(id);
    const data: Prisma.SportEventUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.category !== undefined) data.category = input.category;
    if (input.startsAt !== undefined) data.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined)
      data.endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (input.city !== undefined) data.city = input.city;
    if (input.description !== undefined) data.description = input.description;
    if (input.url !== undefined) data.url = input.url;
    if (input.isMemberFree !== undefined) data.isMemberFree = input.isMemberFree;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const row = await this.prisma.sportEvent.update({ where: { id }, data });
    return this.toEventDto(row);
  }

  async deleteEvent(id: string): Promise<void> {
    await this.adminGetEvent(id);
    await this.prisma.sportEvent.delete({ where: { id } });
  }

  // ── Mappers ─────────────────────────────────────────────────────────
  // Cast Date → ISO string at the service boundary so controllers don't
  // need to handle serialisation, and consumers (mobile) get the same
  // shape regardless of how the model evolves.

  private toFlashSaleDto = (row: {
    id: string;
    title: string;
    subtitle: string | null;
    startsAt: Date;
    endsAt: Date;
    membersOnly: boolean;
    collectionSlug: string | null;
    waitlistCount: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): FlashSaleDto => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    membersOnly: row.membersOnly,
    collectionSlug: row.collectionSlug,
    waitlistCount: row.waitlistCount,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

  private toEventDto = (row: {
    id: string;
    title: string;
    category: string;
    startsAt: Date;
    endsAt: Date | null;
    city: string | null;
    description: string | null;
    url: string | null;
    isMemberFree: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): SportEventDto => ({
    id: row.id,
    title: row.title,
    category: row.category,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    city: row.city,
    description: row.description,
    url: row.url,
    isMemberFree: row.isMemberFree,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
