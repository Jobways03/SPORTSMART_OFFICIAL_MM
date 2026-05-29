import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../core/exceptions';
import { ContentAuditService } from '../storefront-content/content-audit.service';
import { StorefrontContentService } from '../storefront-content/storefront-content.service';

export interface SlotDefinitionDto {
  id: string;
  sectionKey: string;
  slotKey: string;
  label: string;
  position: number;
  defaultHref: string | null;
  isSystem: boolean;
}

export interface CreateSlotInput {
  sectionKey: string;
  slotKey?: string;
  label: string;
  defaultHref?: string | null;
  position?: number;
}

/**
 * Source of truth for which slots exist within each storefront section.
 * Sections themselves (Hero, Sport tiles strip, Banner promo, …) are
 * fixed in storefront code because each carries layout/aspect/tone, but
 * the slot list is data so admins can add / remove slots without a
 * deploy.
 */
@Injectable()
export class StorefrontSlotsService {
  private readonly logger = new Logger(StorefrontSlotsService.name);

  // The set of allowed section keys, kept in sync with the storefront
  // home components. New sections would be a deploy — they need new
  // grid/aspect/tone code, so admins can't add sections, only slots.
  private static readonly ALLOWED_SECTIONS = new Set([
    'hero',
    'sport-tiles-strip',
    'equipping-champions',
    'most-loved-deals',
    'banner-promo',
    'unite-play',
    'partner-promos',
    'brand-chips',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: ContentAuditService,
    @Inject(forwardRef(() => StorefrontContentService))
    private readonly content: StorefrontContentService,
  ) {}

  async list(): Promise<SlotDefinitionDto[]> {
    const rows = await this.prisma.storefrontSlotDefinition.findMany({
      // Phase 47 (2026-05-21) — exclude soft-deleted slots from the
      // admin list. Restore is via the audit log.
      where: { deletedAt: null },
      orderBy: [{ sectionKey: 'asc' }, { position: 'asc' }],
    });
    return rows.map(this.toDto);
  }

  async create(input: CreateSlotInput, actorId?: string): Promise<SlotDefinitionDto> {
    if (!input.label?.trim()) {
      throw new BadRequestAppException('label is required');
    }
    if (!input.sectionKey || !StorefrontSlotsService.ALLOWED_SECTIONS.has(input.sectionKey)) {
      throw new BadRequestAppException(
        `Unknown section "${input.sectionKey}". Allowed: ${[
          ...StorefrontSlotsService.ALLOWED_SECTIONS,
        ].join(', ')}`,
      );
    }

    const slotKey = await this.resolveUniqueSlotKey(
      input.slotKey || this.deriveSlotKey(input.sectionKey, input.label),
    );

    // Position = next at end of section unless an explicit position is
    // supplied. We don't try to re-shuffle existing siblings — admins
    // can manually drag-reorder later if we add that UI.
    let position = input.position ?? 0;
    if (input.position === undefined) {
      const last = await this.prisma.storefrontSlotDefinition.findFirst({
        where: { sectionKey: input.sectionKey },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      position = (last?.position ?? 0) + 1;
    }

    // Phase 47 (2026-05-21) — race-safe create. Pre-Phase-47 the
    // resolveUniqueSlotKey did findUnique-then-create, which left a
    // window for two concurrent creates with the same label to both
    // pass the uniqueness check; the second would hit Prisma P2002
    // and 500. Now we catch P2002 and surface ConflictAppException
    // — admin sees a clean 409.
    let row;
    try {
      row = await this.prisma.storefrontSlotDefinition.create({
        data: {
          sectionKey: input.sectionKey,
          slotKey,
          label: input.label.trim(),
          position,
          defaultHref: input.defaultHref?.trim() || null,
          isSystem: false,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictAppException(
          `Slot key "${slotKey}" was claimed by a concurrent request — retry with a different label`,
        );
      }
      throw err;
    }

    await this.audit.record({
      resourceType: 'SLOT',
      resourceId: row.id,
      action: 'CREATE',
      newState: {
        sectionKey: row.sectionKey,
        slotKey: row.slotKey,
        label: row.label,
        position: row.position,
        isSystem: row.isSystem,
      },
      actorId,
    });
    this.logger.log(
      `Slot created section=${input.sectionKey} key=${slotKey} pos=${position}`,
    );
    return this.toDto(row);
  }

  /**
   * Remove a slot definition. Phase 47 (2026-05-21) changes:
   *   - Refuse to delete `isSystem=true` slots. The seeded 38 slots
   *     are referenced by storefront grid code; removing one drops
   *     a section tile. Admin must deactivate the underlying content
   *     block instead (DELETE /admin/storefront-content/:slot).
   *   - Soft-delete via deletedAt stamp on both rows instead of
   *     hard-delete; the audit log carries the rollback target.
   *   - ContentAuditLog row written for the transition.
   */
  async remove(id: string, actorId?: string): Promise<void> {
    const def = await this.prisma.storefrontSlotDefinition.findUnique({
      where: { id },
    });
    if (!def || def.deletedAt) throw new NotFoundAppException('Slot definition not found');

    if (def.isSystem) {
      throw new ForbiddenAppException(
        `Slot "${def.slotKey}" is a system slot — deactivate the content block instead of deleting the slot`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Soft-delete the content block first (if present) so the
      // public listActiveAsMap stops serving it immediately.
      await tx.storefrontContentBlock.updateMany({
        where: { slot: def.slotKey, deletedAt: null },
        data: { deletedAt: new Date(), active: false },
      });
      await tx.storefrontSlotDefinition.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });

    await this.audit.record({
      resourceType: 'SLOT',
      resourceId: def.id,
      action: 'DELETE',
      prevState: {
        sectionKey: def.sectionKey,
        slotKey: def.slotKey,
        label: def.label,
        position: def.position,
        isSystem: def.isSystem,
      },
      actorId,
    });
    // Phase 47 — soft-deleted content block must drop from the active
    // map immediately. Best-effort: cache TTL would heal in 30s
    // anyway.
    await this.content.invalidateActiveMapCache();
    this.logger.log(`Slot soft-deleted section=${def.sectionKey} key=${def.slotKey}`);
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private async resolveUniqueSlotKey(raw: string): Promise<string> {
    const base = this.slugify(raw);
    if (!base) {
      throw new BadRequestAppException(
        'slot key cannot be derived — pass an explicit slotKey or use a label with letters/numbers',
      );
    }
    let candidate = base;
    let attempt = 1;
    while (true) {
      // Phase 47 — uniqueness check ignores soft-deleted rows so an
      // admin can recreate a slot key after a soft-delete. The final
      // create() still races on the DB unique constraint, but
      // create() now catches P2002.
      const clash = await this.prisma.storefrontSlotDefinition.findFirst({
        where: { slotKey: candidate, deletedAt: null },
        select: { id: true },
      });
      if (!clash) return candidate;
      attempt += 1;
      candidate = `${base}-${attempt}`;
      if (attempt > 50) {
        throw new ConflictAppException(
          'Too many slots share this label — try a more specific name',
        );
      }
    }
  }

  private deriveSlotKey(sectionKey: string, label: string): string {
    // Sections use a stable prefix in the seeded data (sport-cricket,
    // champ-running, …). Use the section key's first segment as the
    // prefix so newly-created slots fit the same pattern.
    const prefixMap: Record<string, string> = {
      hero: 'hero-slide',
      'sport-tiles-strip': 'sport',
      'equipping-champions': 'champ',
      'most-loved-deals': 'deal',
      'banner-promo': 'banner',
      'unite-play': 'play',
      'partner-promos': 'promo',
      'brand-chips': 'brand',
    };
    const prefix = prefixMap[sectionKey] ?? 'slot';
    return `${prefix}-${label}`;
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .trim()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
  }

  private toDto = (row: {
    id: string;
    sectionKey: string;
    slotKey: string;
    label: string;
    position: number;
    defaultHref: string | null;
    isSystem: boolean;
  }): SlotDefinitionDto => ({
    id: row.id,
    sectionKey: row.sectionKey,
    slotKey: row.slotKey,
    label: row.label,
    position: row.position,
    defaultHref: row.defaultHref,
    isSystem: row.isSystem,
  });
}
