import { Inject, Injectable } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { Prisma } from '@prisma/client';
import {
  DiscountRepository,
  DISCOUNT_REPOSITORY,
} from '../../domain/repositories/discount.repository.interface';
import { AffiliatePublicFacade } from '../../../affiliate/application/facades/affiliate-public.facade';
import { DiscountEventsService } from './discount-events.service';
import { DiscountEligibilityService } from './discount-eligibility.service';
import type { EligibilityRule } from '../../domain/eligibility/types';

@Injectable()
export class DiscountsService {
  constructor(
    @Inject(DISCOUNT_REPOSITORY)
    private readonly discountRepo: DiscountRepository,
    private readonly affiliatePublicFacade: AffiliatePublicFacade,
    // Phase E (P1.1) — audit + outbox emission. Best-effort calls;
    // service operations don't fail if the audit sink is down.
    private readonly events: DiscountEventsService,
    // Phase E (P1.3) — eligibility evaluator. Loads rules + checks
    // against customer + cart at validate time.
    private readonly eligibility: DiscountEligibilityService,
  ) {}

  async list(filters: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
  }) {
    const { page, limit, status, search } = filters;
    const where: Prisma.DiscountWhereInput = {};
    if (status && status !== 'ALL') where.status = status as any;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [discounts, total] = await Promise.all([
      this.discountRepo.findMany(
        where,
        { createdAt: 'desc' },
        (page - 1) * limit,
        limit,
      ),
      this.discountRepo.count(where),
    ]);

    return {
      discounts: discounts.map((d) => this.withEffectiveStatus(d)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async get(id: string) {
    const discount = await this.discountRepo.findByIdWithRelations(id);
    if (!discount) throw new NotFoundAppException('Discount not found');
    return this.withEffectiveStatus(discount);
  }

  // Operator/abuse-driven states are explicit and must NOT be recomputed
  // from the date window — only the three date-derived labels
  // (ACTIVE/SCHEDULED/EXPIRED) are inferred. Phase 243: a PAUSED, ARCHIVED,
  // or SUSPENDED_FOR_ABUSE discount previously got silently flipped back to
  // ACTIVE/SCHEDULED/EXPIRED here, so the lifecycle never surfaced.
  private static readonly STICKY_STATUSES = new Set([
    'DRAFT',
    'PAUSED',
    'ARCHIVED',
    'SUSPENDED_FOR_ABUSE',
  ]);

  // Derive the current effective status from the date window, so a SCHEDULED
  // discount whose `startsAt` has passed shows as ACTIVE (and one past its
  // `endsAt` shows as EXPIRED) without needing a background job to rewrite
  // the stored label. Sticky operator states are preserved verbatim.
  private withEffectiveStatus<T extends {
    status: string;
    startsAt: Date | string | null;
    endsAt: Date | string | null;
  }>(d: T): T {
    if (!d || DiscountsService.STICKY_STATUSES.has(d.status)) return d;
    const now = new Date();
    const start = d.startsAt ? new Date(d.startsAt) : null;
    const end = d.endsAt ? new Date(d.endsAt) : null;
    let effective: string = d.status;
    if (start && start > now) effective = 'SCHEDULED';
    else if (end && end < now) effective = 'EXPIRED';
    else effective = 'ACTIVE';
    return { ...d, status: effective };
  }

  async create(
    data: any,
    // Phase 243 (#4) — admin actor for attribution + the audit trail.
    actor?: { actorId?: string | null; actorRole?: string | null },
  ) {
    const {
      code,
      title,
      type,
      method,
      productIds,
      collectionIds,
      buyProductIds,
      getProductIds,
      startsAt,
      endsAt,
      eligibilityRules,
      ...rest
    } = data;

    if (!type) throw new BadRequestAppException('Discount type is required');
    if (method === 'CODE' && !code?.trim())
      throw new BadRequestAppException('Discount code is required');
    if (method === 'AUTOMATIC' && !title?.trim())
      throw new BadRequestAppException('Discount title is required');

    // PERCENTAGE > 100 would refund more than the customer paid; negative
    // would add to the total. (The DTO also bounds these — defence in depth.)
    this.validateDiscountValue(rest.valueType, rest.value);
    if (rest.getDiscountValue !== undefined && rest.getDiscountValue !== null) {
      this.validateDiscountValue(rest.getDiscountType, rest.getDiscountValue);
    }

    // Phase 243 (#11) — a BOGO whose free-unit count exceeds its per-order
    // cap is an inconsistent config (the cap silently wins at checkout).
    if (type === 'BUY_X_GET_Y') {
      const gq = rest.getQuantity != null ? Number(rest.getQuantity) : null;
      const mupo =
        rest.maxUsesPerOrder != null ? Number(rest.maxUsesPerOrder) : null;
      if (gq != null && mupo != null && gq > mupo) {
        throw new BadRequestAppException(
          'getQuantity cannot exceed maxUsesPerOrder',
        );
      }
    }

    // Phase 247 (#11) — a SELLER-funded discount applied to ALL_PRODUCTS
    // debits every seller in a multi-seller cart, including ones who never
    // agreed to fund it. Require it to be scoped to specific products.
    const fundingType = (rest.fundingType as string) || 'PLATFORM';
    if (
      fundingType === 'SELLER' &&
      (rest.appliesTo ?? 'ALL_PRODUCTS') === 'ALL_PRODUCTS'
    ) {
      throw new BadRequestAppException(
        'SELLER-funded discounts must target specific products (a single seller), not ALL_PRODUCTS',
      );
    }

    if (code?.trim()) {
      const upper = code.trim().toUpperCase();
      const existing = await this.discountRepo.findByCode(upper);
      if (existing)
        throw new BadRequestAppException('Discount code already exists');
      // Phase 244 (#10) — cross-table collision: if an affiliate coupon
      // owns this code, the Discount path would win at checkout and the
      // affiliate's code would silently become unreachable.
      if (await this.affiliatePublicFacade.couponCodeExists(upper)) {
        throw new BadRequestAppException(
          'This code is already in use by an affiliate coupon',
        );
      }
    }

    // Phase 243 (#15) — validate the affiliate link exists up front.
    if (rest.affiliateId) {
      if (!(await this.affiliatePublicFacade.affiliateExists(rest.affiliateId))) {
        throw new BadRequestAppException('Affiliate not found');
      }
    }

    // Phase 243 (#13) — pre-validate product/collection FK targets so a
    // stale id surfaces a clean 400 instead of a raw P2003 → 500 mid-write.
    const allProductIds = [
      ...new Set<string>([
        ...((productIds as string[]) ?? []),
        ...((buyProductIds as string[]) ?? []),
        ...((getProductIds as string[]) ?? []),
      ]),
    ];
    if (allProductIds.length) {
      const found = await this.discountRepo.findExistingProductIds(allProductIds);
      const missing = allProductIds.filter((id) => !found.includes(id));
      if (missing.length) {
        throw new BadRequestAppException(
          `Unknown product id(s): ${missing.slice(0, 10).join(', ')}`,
        );
      }
    }
    if (collectionIds?.length) {
      const found = await this.discountRepo.findExistingCollectionIds(
        collectionIds,
      );
      const missing = (collectionIds as string[]).filter(
        (id) => !found.includes(id),
      );
      if (missing.length) {
        throw new BadRequestAppException(
          `Unknown collection id(s): ${missing.slice(0, 10).join(', ')}`,
        );
      }
    }

    const now = new Date();
    const start = startsAt ? new Date(startsAt) : now;
    const end = endsAt ? new Date(endsAt) : null;
    if (end && end <= start) {
      throw new BadRequestAppException(
        'endsAt must be after startsAt — an always-expired discount cannot be created',
      );
    }
    // Phase 243 (#18) — honor an explicit "Save as draft"; otherwise derive
    // the status from the date window.
    let status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DRAFT';
    if (rest.status === 'DRAFT') {
      status = 'DRAFT';
    } else {
      status = 'ACTIVE';
      if (start > now) status = 'SCHEDULED';
      if (end && end < now) status = 'EXPIRED';
    }

    // Phase B (P0.5) / 247-FB — funding fields with safe defaults. Validate
    // SHARED percentages sum to 100 server-side regardless of UI.
    const platformFundingPercent = Number(rest.platformFundingPercent ?? 100);
    const sellerFundingPercent = Number(rest.sellerFundingPercent ?? 0);
    const brandFundingPercent = Number(rest.brandFundingPercent ?? 0);
    const franchiseFundingPercent = Number(rest.franchiseFundingPercent ?? 0);
    if (fundingType === 'SHARED') {
      const sum =
        platformFundingPercent +
        sellerFundingPercent +
        brandFundingPercent +
        franchiseFundingPercent;
      if (Math.abs(sum - 100) > 0.01) {
        throw new BadRequestAppException(
          `SHARED funding percentages must sum to 100% (got ${sum})`,
        );
      }
    }
    // Phase 247-FB — a BRAND-funded discount (pure or a SHARED brand share)
    // must name the brand it bills, else the cost is unattributable.
    if (
      (fundingType === 'BRAND' ||
        (fundingType === 'SHARED' && brandFundingPercent > 0)) &&
      !rest.brandId
    ) {
      throw new BadRequestAppException(
        'BRAND-funded discounts require a brandId (which brand bears the cost)',
      );
    }

    const payload = {
      code: code ? code.trim().toUpperCase() : null,
      title: title?.trim() || null,
      // Phase 243 (#2) — the legacy scalar eligibility is now persisted.
      eligibility: (rest.eligibility as string) || 'ALL_CUSTOMERS',
      descriptionLong: rest.descriptionLong?.trim() || null,
      type,
      method: method || 'CODE',
      valueType: rest.valueType || 'PERCENTAGE',
      value: rest.value || 0,
      // Phase 243 — optional PERCENT cap, stored in paise.
      maxDiscountAmountInPaise:
        rest.maxDiscountAmountInPaise != null
          ? BigInt(rest.maxDiscountAmountInPaise)
          : null,
      appliesTo: rest.appliesTo || 'ALL_PRODUCTS',
      minRequirement: rest.minRequirement || 'NONE',
      minRequirementValue: rest.minRequirementValue || null,
      maxUses: rest.maxUses || null,
      onePerCustomer: rest.onePerCustomer || false,
      combineProduct: rest.combineProduct || false,
      combineOrder: rest.combineOrder || false,
      combineShipping: rest.combineShipping || false,
      startsAt: start,
      endsAt: end,
      status,
      buyType: rest.buyType || null,
      buyValue: rest.buyValue || null,
      buyItemsFrom: rest.buyItemsFrom || null,
      getQuantity: rest.getQuantity || null,
      getItemsFrom: rest.getItemsFrom || null,
      getDiscountType: rest.getDiscountType || null,
      getDiscountValue: rest.getDiscountValue || null,
      maxUsesPerOrder: rest.maxUsesPerOrder || null,
      // Phase B (P0.5) / 247-FB
      fundingType: fundingType as any,
      platformFundingPercent,
      sellerFundingPercent,
      brandFundingPercent,
      franchiseFundingPercent,
      franchiseId: rest.franchiseId || null,
      brandId: rest.brandId || null,
      commissionBasis: (rest.commissionBasis as any) || 'GROSS',
      fundingNotes: rest.fundingNotes || null,
      discountNature: (rest.discountNature as any) || 'TRANSACTIONAL',
      affiliateId: rest.affiliateId || null,
      affiliateCommissionPercent:
        rest.affiliateCommissionPercent !== undefined &&
        rest.affiliateCommissionPercent !== null &&
        rest.affiliateCommissionPercent !== ''
          ? Number(rest.affiliateCommissionPercent)
          : null,
      // Phase 243 (#4) — actor attribution.
      createdById: actor?.actorId ?? null,
      updatedById: actor?.actorId ?? null,
    };

    // Phase 243 (#5) — discount row + scope links written atomically so a
    // link failure can't leave a half-built discount. P2002 (a concurrent
    // duplicate code that slipped past the pre-check) becomes a clean 400.
    let discount: any;
    try {
      discount = await this.discountRepo.createWithRelations(payload as any, {
        productIds,
        collectionIds,
        buyProductIds,
        getProductIds,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestAppException('Discount code already exists');
      }
      throw e;
    }

    // Phase E (P1.3) — eligibility rules. Replace the rule set in
    // one shot; omitted/empty array means "no eligibility gating".
    if (Array.isArray(eligibilityRules) && eligibilityRules.length > 0) {
      await this.eligibility.setRules(discount.id, eligibilityRules);
    }

    // Phase E (P1.1) / 243 (#4) — audit + outbox with the admin actor.
    void this.events.emitDiscountCrud({
      action: 'created',
      discountId: discount.id,
      newValue: discount as Record<string, unknown>,
      context: { actorId: actor?.actorId, actorRole: actor?.actorRole },
    });

    return discount;
  }

  // Phase 243 (#8) — fields that materially change the money math or the
  // identity of a coupon. Once a discount has been redeemed (usedCount > 0)
  // these are frozen: an admin bumping 10% → 90% on a live coupon would
  // silently 9× the discount for everyone mid-checkout. The safe path is
  // pause + clone a new version.
  private static readonly LOCKED_ON_LIVE = [
    'code',
    'type',
    'value',
    'valueType',
    'maxDiscountAmountInPaise',
    'fundingType',
    'platformFundingPercent',
    'sellerFundingPercent',
    'brandFundingPercent',
    'franchiseFundingPercent',
    'commissionBasis',
    'buyType',
    'buyValue',
    'getDiscountType',
    'getDiscountValue',
    'getQuantity',
  ];

  async update(
    id: string,
    body: any,
    actor?: { actorId?: string | null; actorRole?: string | null },
  ) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');

    const {
      productIds,
      collectionIds,
      buyProductIds,
      getProductIds,
      startsAt,
      endsAt,
      eligibilityRules,
      expectedVersion,
      ...fields
    } = body;
    // `status` is never settable via this path (#7) — it goes through the
    // dedicated FSM endpoint. Strip it defensively even if it slips through.
    delete (fields as any).status;

    // Phase 243 (#8 / OCC) — reject a stale two-admin write.
    if (
      expectedVersion !== undefined &&
      expectedVersion !== null &&
      Number(expectedVersion) !== (discount as any).version
    ) {
      throw new ConflictAppException(
        'This discount was changed by someone else — reload and retry',
      );
    }

    // Phase 243 (#8) — freeze money/identity fields on a live discount.
    if ((discount as any).usedCount > 0) {
      const attempted = DiscountsService.LOCKED_ON_LIVE.filter(
        (k) => fields[k] !== undefined,
      );
      if (attempted.length) {
        throw new ConflictAppException(
          `Cannot change ${attempted.join(', ')} on a discount with ${(discount as any).usedCount} redemption(s). Pause it and create a new version instead.`,
        );
      }
    }

    const data: any = {};

    // Same bounds guard as create — if the caller is changing the value
    // or the value type, re-validate. Unchanged fields are left alone.
    if (fields.value !== undefined || fields.valueType !== undefined) {
      const nextValueType =
        fields.valueType ?? (discount as any).valueType;
      const nextValue =
        fields.value !== undefined ? fields.value : (discount as any).value;
      this.validateDiscountValue(nextValueType, Number(nextValue));
    }
    if (fields.getDiscountValue !== undefined) {
      const nextType =
        fields.getDiscountType ?? (discount as any).getDiscountType;
      this.validateDiscountValue(nextType, fields.getDiscountValue);
    }

    // Phase 247 (#13) — SHARED funding split must still sum to 100 on update.
    const nextFundingType =
      fields.fundingType ?? (discount as any).fundingType;
    if (
      nextFundingType === 'SHARED' &&
      (fields.platformFundingPercent !== undefined ||
        fields.sellerFundingPercent !== undefined ||
        fields.brandFundingPercent !== undefined ||
        fields.franchiseFundingPercent !== undefined)
    ) {
      const p = Number(
        fields.platformFundingPercent ?? (discount as any).platformFundingPercent,
      );
      const s = Number(
        fields.sellerFundingPercent ?? (discount as any).sellerFundingPercent,
      );
      const b = Number(
        fields.brandFundingPercent ?? (discount as any).brandFundingPercent,
      );
      const f = Number(
        fields.franchiseFundingPercent ??
          (discount as any).franchiseFundingPercent ??
          0,
      );
      if (Math.abs(p + s + b + f - 100) > 0.01) {
        throw new BadRequestAppException(
          `SHARED funding percentages must sum to 100% (got ${p + s + b + f})`,
        );
      }
    }

    // Phase 243 (#15) — validate a (re)attached affiliate exists.
    if (fields.affiliateId) {
      if (!(await this.affiliatePublicFacade.affiliateExists(fields.affiliateId))) {
        throw new BadRequestAppException('Affiliate not found');
      }
    }

    for (const key of [
      'code',
      'title',
      'eligibility',
      'descriptionLong',
      'valueType',
      'value',
      'maxDiscountAmountInPaise',
      'appliesTo',
      'minRequirement',
      'minRequirementValue',
      'maxUses',
      'onePerCustomer',
      'combineProduct',
      'combineOrder',
      'combineShipping',
      'buyType',
      'buyValue',
      'buyItemsFrom',
      'getQuantity',
      'getItemsFrom',
      'getDiscountType',
      'getDiscountValue',
      'maxUsesPerOrder',
      'fundingType',
      'platformFundingPercent',
      'sellerFundingPercent',
      'brandFundingPercent',
      'franchiseFundingPercent',
      'franchiseId',
      'brandId',
      'commissionBasis',
      'fundingNotes',
      'discountNature',
    ]) {
      if (fields[key] !== undefined) {
        if (key === 'code') {
          data[key] = fields[key] ? fields[key].trim().toUpperCase() : null;
        } else if (key === 'maxDiscountAmountInPaise') {
          data[key] = fields[key] != null ? BigInt(fields[key]) : null;
        } else {
          data[key] = fields[key];
        }
      }
    }
    if (startsAt !== undefined) data.startsAt = new Date(startsAt);
    if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null;

    // Phase F (P2.3) — affiliate link add/swap/clear; commission override
    // is independent and clears with explicit null.
    if (fields.affiliateId !== undefined) {
      data.affiliateId = fields.affiliateId || null;
    }
    if (fields.affiliateCommissionPercent !== undefined) {
      data.affiliateCommissionPercent =
        fields.affiliateCommissionPercent === null || fields.affiliateCommissionPercent === ''
          ? null
          : Number(fields.affiliateCommissionPercent);
    }

    // Phase 243 (#13) — validate product/collection FK targets being set.
    const updatedProductIds = [
      ...new Set<string>([
        ...((productIds as string[]) ?? []),
        ...((buyProductIds as string[]) ?? []),
        ...((getProductIds as string[]) ?? []),
      ]),
    ];
    if (updatedProductIds.length) {
      const found = await this.discountRepo.findExistingProductIds(
        updatedProductIds,
      );
      const missing = updatedProductIds.filter((pid) => !found.includes(pid));
      if (missing.length) {
        throw new BadRequestAppException(
          `Unknown product id(s): ${missing.slice(0, 10).join(', ')}`,
        );
      }
    }
    if (collectionIds && collectionIds.length) {
      const found = await this.discountRepo.findExistingCollectionIds(
        collectionIds,
      );
      const missing = (collectionIds as string[]).filter(
        (cid) => !found.includes(cid),
      );
      if (missing.length) {
        throw new BadRequestAppException(
          `Unknown collection id(s): ${missing.slice(0, 10).join(', ')}`,
        );
      }
    }

    // Phase 243 (#4/#8) — actor + version bump.
    data.updatedById = actor?.actorId ?? (discount as any).updatedById ?? null;
    data.version = { increment: 1 };

    // Phase 243 (#5) — update + scope-link replace written atomically.
    let updated: any;
    try {
      updated = await this.discountRepo.updateWithRelations(id, data, {
        productIds,
        collectionIds,
        buyProductIds,
        getProductIds,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestAppException('Discount code already exists');
      }
      throw e;
    }

    // Phase E (P1.3) — eligibility rules. `undefined` = leave alone,
    // explicit array (incl. []) = replace the rule set.
    if (eligibilityRules !== undefined) {
      await this.eligibility.setRules(id, Array.isArray(eligibilityRules) ? eligibilityRules : []);
    }

    // Phase E (P1.1) / 243 (#4) — audit + outbox with old/new diff + actor.
    void this.events.emitDiscountCrud({
      action: 'updated',
      discountId: id,
      oldValue: discount as Record<string, unknown>,
      newValue: updated as Record<string, unknown>,
      context: { actorId: actor?.actorId, actorRole: actor?.actorRole },
    });

    return updated;
  }

  /**
   * Phase 243 (#6/#7) — explicit status FSM. The generic update path can no
   * longer touch `status`; operator transitions (Pause/Resume/Archive,
   * publish-from-DRAFT) go through here with a validated transition + audit.
   * SUSPENDED_FOR_ABUSE is reachable only via {@link suspendForAbuse}.
   */
  private static readonly STATUS_FSM: Record<string, string[]> = {
    ACTIVE: ['PAUSED', 'ARCHIVED'],
    SCHEDULED: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
    EXPIRED: ['ACTIVE', 'ARCHIVED'],
    DRAFT: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
    PAUSED: ['ACTIVE', 'ARCHIVED', 'DRAFT'],
    ARCHIVED: [],
    SUSPENDED_FOR_ABUSE: [], // only the abuse-action path can move this
  };

  async setStatus(
    id: string,
    newStatus: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DRAFT',
    actor?: { actorId?: string | null; actorRole?: string | null },
    reason?: string,
  ) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');
    const current = (discount as any).status as string;
    if (current === newStatus) return this.withEffectiveStatus(discount);
    const allowed = DiscountsService.STATUS_FSM[current] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new ConflictAppException(
        `Cannot move discount from ${current} to ${newStatus}`,
      );
    }
    const updated = await this.discountRepo.update(id, {
      status: newStatus as any,
      updatedById: actor?.actorId ?? null,
      version: { increment: 1 },
    });
    void this.events.emitDiscountCrud({
      action: newStatus === 'ARCHIVED' ? 'disabled' : 'updated',
      discountId: id,
      oldValue: { status: current, reason } as Record<string, unknown>,
      newValue: updated as Record<string, unknown>,
      context: { actorId: actor?.actorId, actorRole: actor?.actorRole },
    });
    return this.withEffectiveStatus(updated);
  }

  /**
   * Phase 245 (abuse-detection audit #15) — kill / un-kill a leaking coupon
   * from the risk surface. Distinct from the operator FSM: it can suspend
   * from any non-archived state and only this path (gated by
   * discounts.abuse.action) can reactivate a SUSPENDED_FOR_ABUSE coupon.
   */
  async suspendForAbuse(
    id: string,
    suspend: boolean,
    actor?: { actorId?: string | null; actorRole?: string | null },
    reason?: string,
  ) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');
    const current = (discount as any).status as string;
    if (suspend && current === 'ARCHIVED') {
      throw new ConflictAppException('Cannot suspend an archived discount');
    }
    const target = suspend ? 'SUSPENDED_FOR_ABUSE' : 'ACTIVE';
    const updated = await this.discountRepo.update(id, {
      status: target as any,
      updatedById: actor?.actorId ?? null,
      version: { increment: 1 },
    });
    void this.events.emitDiscountCrud({
      action: suspend ? 'disabled' : 'activated',
      discountId: id,
      oldValue: { status: current, reason } as Record<string, unknown>,
      newValue: updated as Record<string, unknown>,
      context: { actorId: actor?.actorId, actorRole: actor?.actorRole },
    });
    return this.withEffectiveStatus(updated);
  }

  async delete(id: string) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');
    await this.discountRepo.delete(id);
    // Phase E (P1.1) — audit-log the deletion. Outbox consumers can
    // react (e.g. cancel pending notification campaigns).
    void this.events.emitDiscountCrud({
      action: 'deleted',
      discountId: id,
      oldValue: discount as Record<string, unknown>,
    });
  }

  /**
   * Customer-side coupon validation used at checkout. Returns the resolved
   * discount + amount or throws with a caller-friendly message. The amount
   * is rounded to 2dp and capped at `subtotal` so a flat coupon larger
   * than the cart never produces a negative total.
   */
  async validateCouponForCheckout(
    code: string,
    subtotal: number,
    items: Array<{ productId: string; quantity: number; unitPrice: number }> = [],
    /**
     * Phase E (P1.3) — optional customer + cart context for the
     * eligibility evaluator. Caller (the customer-discounts
     * controller / checkout service) supplies what it knows;
     * unknown fields cause matching rules to SKIP rather than
     * reject, so older callers that don't yet pass these fields
     * stay backward-compatible.
     */
    eligibilityArgs?: {
      customerId?: string | null;
      paymentMethod?: 'COD' | 'ONLINE' | 'WALLET' | 'UPI' | string;
      address?: { city?: string | null; pincode?: string | null; state?: string | null };
    },
  ): Promise<{
    discountId: string;
    code: string;
    title: string | null;
    type: string;
    valueType: string;
    value: number;
    discountAmount: number;
  }> {
    const trimmed = (code || '').trim().toUpperCase();
    if (!trimmed) {
      throw new BadRequestAppException('Enter a coupon code');
    }
    const discount = await this.discountRepo.findByCodeWithProducts(trimmed);
    if (!discount) {
      // Fall through to affiliate-coupon lookup. Affiliate codes
      // (issued in AffiliateCouponCode on approval) live outside the
      // regular Discount table — without this fallback the storefront
      // rejects every affiliate code as "Invalid".
      try {
        const aff = await this.affiliatePublicFacade.validateAffiliateCouponForCustomer({
          code: trimmed,
          subtotal,
        });
        if (aff) {
          // Phase 158 — map the affiliate valueType to the canonical coupon
          // `type`. FREE_SHIPPING must flow to the shipping-waiver path
          // (checkout.service zeros the shipping fee when type==='FREE_SHIPPING');
          // every other affiliate discount is an ordinary order-level amount off.
          return {
            ...aff,
            type:
              aff.valueType === 'FREE_SHIPPING'
                ? 'FREE_SHIPPING'
                : 'AMOUNT_OFF_ORDER',
          };
        }
      } catch (err: any) {
        // Facade throws a plain Error with a customer-safe message
        // when the code is ours but a constraint failed (expired,
        // min-order, etc.). Surface it via the standard exception.
        throw new BadRequestAppException(err?.message ?? 'Invalid coupon code');
      }
      throw new BadRequestAppException('Invalid coupon code');
    }
    if (discount.method !== 'CODE') {
      throw new BadRequestAppException('This code cannot be applied manually');
    }
    // Explicit operator/abuse "disabled" states always reject (Phase 243/245
    // — PAUSED, ARCHIVED, SUSPENDED_FOR_ABUSE join DRAFT). For
    // ACTIVE/SCHEDULED/EXPIRED the stored status can go stale (snapshotted at
    // create/update time), so the date window below is the source of truth.
    if (
      ['DRAFT', 'PAUSED', 'ARCHIVED', 'SUSPENDED_FOR_ABUSE'].includes(
        discount.status,
      )
    ) {
      throw new BadRequestAppException('This coupon is no longer available');
    }
    // FREE_SHIPPING is a separate code path — the discount itself reduces
    // the shipping fee at place-order time (handled in checkout.service.ts),
    // not the product subtotal. We resolve it here with discountAmount=0
    // so the cart-total math is unaffected; checkout zeros the shipping
    // fee when the redeemed discount has type=FREE_SHIPPING.
    const now = new Date();
    if (discount.startsAt && new Date(discount.startsAt) > now) {
      throw new BadRequestAppException('This coupon is not active yet');
    }
    if (discount.endsAt && new Date(discount.endsAt) < now) {
      throw new BadRequestAppException('This coupon has expired');
    }
    if (
      discount.maxUses !== null &&
      discount.maxUses !== undefined &&
      discount.usedCount >= discount.maxUses
    ) {
      throw new BadRequestAppException('This coupon has reached its usage limit');
    }
    if (
      discount.minRequirement === 'MIN_PURCHASE_AMOUNT' &&
      discount.minRequirementValue !== null &&
      Number(subtotal) < Number(discount.minRequirementValue)
    ) {
      throw new BadRequestAppException(
        `This coupon requires a minimum order of ₹${Number(
          discount.minRequirementValue,
        ).toLocaleString('en-IN')}`,
      );
    }

    // Phase E (P1.3) — eligibility rules. Run only when we have a
    // customerId; without one we can't run customer-scoped rules
    // (FIRST_ORDER_ONLY, NEW_CUSTOMER_ONLY, velocity, etc.) and
    // would always pass them. The rule evaluator already SKIPs
    // missing fields, but skipping the check entirely when there's
    // no customer avoids the DB roundtrip in that case.
    if (eligibilityArgs?.customerId) {
      const verdict = await this.eligibility.check({
        discountId: discount.id,
        customerId: eligibilityArgs.customerId,
        cart: {
          // Items as best-effort — caller passes the limited shape
          // it has today. Rules that need richer data (categoryId,
          // sellerId, collectionIds) will SKIP if they're missing.
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPriceInPaise: BigInt(Math.round(Number(i.unitPrice) * 100)),
          })),
          paymentMethod: eligibilityArgs.paymentMethod,
          address: eligibilityArgs.address ?? undefined,
        },
      });
      if (!verdict.allowed) {
        throw new BadRequestAppException(
          verdict.reason ?? 'This coupon is not valid for your order.',
        );
      }
    }

    // ── Flat cart discounts (AMOUNT_OFF_ORDER / AMOUNT_OFF_PRODUCTS) ─────
    // Both apply against the subtotal today. (AMOUNT_OFF_PRODUCTS would
    // ideally be narrowed to matching line items, but we fall back to the
    // whole subtotal here — same as what the rest of the pipeline expects.)
    if (discount.type !== 'BUY_X_GET_Y') {
      const valueType: string = discount.valueType || 'PERCENTAGE';
      const value = Number(discount.value || 0);
      let amount = 0;
      if (valueType === 'PERCENTAGE') {
        amount = (Number(subtotal) * value) / 100;
        // Phase 243 (key-finding) — "X% off up to ₹Y" ceiling.
        if (
          discount.maxDiscountAmountInPaise !== null &&
          discount.maxDiscountAmountInPaise !== undefined
        ) {
          const capRupees = Number(discount.maxDiscountAmountInPaise) / 100;
          amount = Math.min(amount, capRupees);
        }
      } else {
        amount = value;
      }
      amount = Math.max(0, Math.min(amount, Number(subtotal)));
      amount = Math.round(amount * 100) / 100;
      return {
        discountId: discount.id,
        code: discount.code!,
        title: discount.title ?? null,
        type: discount.type,
        valueType,
        value,
        discountAmount: amount,
      };
    }

    // ── BUY_X_GET_Y ──────────────────────────────────────────────────────
    // Requires cart line items. The buy/get product sets are inferred from
    // DiscountProduct rows (scopes BUY / GET). An empty set means "any
    // product qualifies" — mirrors Shopify's default.
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestAppException(
        'Add the required items to your cart before applying this coupon.',
      );
    }
    const buyProductIds = new Set<string>(
      (discount.products || [])
        .filter((p: any) => p.scope === 'BUY')
        .map((p: any) => p.productId),
    );
    const getProductIds = new Set<string>(
      (discount.products || [])
        .filter((p: any) => p.scope === 'GET')
        .map((p: any) => p.productId),
    );
    const isBuyEligible = (pid: string) =>
      buyProductIds.size === 0 || buyProductIds.has(pid);
    const isGetEligible = (pid: string) =>
      getProductIds.size === 0 || getProductIds.has(pid);

    // Check buy condition
    let buyCount = 0;
    let buyAmount = 0;
    for (const it of items) {
      if (isBuyEligible(it.productId)) {
        buyCount += Number(it.quantity) || 0;
        buyAmount += (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
      }
    }
    const buyValueNum = Number(discount.buyValue || 0);
    if (discount.buyType === 'MIN_QUANTITY' && buyCount < buyValueNum) {
      throw new BadRequestAppException(
        `Add ${buyValueNum - buyCount} more qualifying item(s) to unlock this coupon.`,
      );
    }
    if (discount.buyType === 'MIN_AMOUNT' && buyAmount < buyValueNum) {
      throw new BadRequestAppException(
        `This coupon requires qualifying items worth ₹${buyValueNum.toLocaleString('en-IN')} in cart.`,
      );
    }

    // Collect get-eligible units, cheapest first, up to getQuantity.
    // When the same product qualifies for both buy and get (and is not
    // over-stocked), we reserve `buyValueNum` units for the buy side (when
    // buyType is MIN_QUANTITY) so we don't discount the customer's entry
    // ticket into the promo.
    const getQuantity = Math.max(1, Number(discount.getQuantity || 1));
    const perUnit: Array<{ unitPrice: number; productId: string }> = [];
    for (const it of items) {
      if (!isGetEligible(it.productId)) continue;
      let availableQty = Number(it.quantity) || 0;
      const sharesBuyAndGet =
        buyProductIds.size > 0 &&
        getProductIds.size > 0 &&
        isBuyEligible(it.productId) &&
        buyProductIds.has(it.productId) &&
        getProductIds.has(it.productId);
      // Reserve the buy-side "entry ticket" units so the customer can't get
      // the same unit they had to buy as the free/discounted GET unit.
      if (sharesBuyAndGet && discount.buyType === 'MIN_QUANTITY') {
        availableQty = Math.max(0, availableQty - buyValueNum);
      } else if (
        sharesBuyAndGet &&
        discount.buyType === 'MIN_AMOUNT' &&
        Number(it.unitPrice) > 0
      ) {
        // Phase 246 (recon #3) — MIN_AMOUNT was NOT reserving the entry
        // ticket, so a single ₹2000 item under "buy ₹1000 get 1 free" was
        // given away free (100% off the only item). Reserve enough units to
        // cover the buy threshold at this unit's price.
        const reservedUnits = Math.ceil(buyValueNum / Number(it.unitPrice));
        availableQty = Math.max(0, availableQty - reservedUnits);
      }
      for (let i = 0; i < availableQty; i++) {
        perUnit.push({ unitPrice: Number(it.unitPrice) || 0, productId: it.productId });
      }
    }
    perUnit.sort((a, b) => a.unitPrice - b.unitPrice);
    // Phase 243 (#11) — cap discounted units at maxUsesPerOrder when set, so
    // a BOGO with maxUsesPerOrder=1 doesn't discount every eligible pair.
    const perOrderCap =
      discount.maxUsesPerOrder != null && Number(discount.maxUsesPerOrder) > 0
        ? Math.min(getQuantity, Number(discount.maxUsesPerOrder))
        : getQuantity;
    const discounted = perUnit.slice(0, perOrderCap);
    if (discounted.length === 0) {
      throw new BadRequestAppException(
        'Add the free/discounted item to your cart to apply this coupon.',
      );
    }

    let amount = 0;
    const gdType = discount.getDiscountType || 'FREE';
    const gdValue = Number(discount.getDiscountValue || 0);
    for (const u of discounted) {
      if (gdType === 'FREE') amount += u.unitPrice;
      else if (gdType === 'PERCENTAGE') amount += (u.unitPrice * gdValue) / 100;
      else if (gdType === 'AMOUNT_OFF') amount += Math.min(u.unitPrice, gdValue);
    }
    amount = Math.max(0, Math.min(amount, Number(subtotal)));
    amount = Math.round(amount * 100) / 100;

    // Report a sensible display `value` for the UI pill. PERCENTAGE and
    // AMOUNT_OFF use getDiscountValue directly. FREE is 100% off matching
    // units, so show 100 as a percent.
    const displayValueType =
      gdType === 'AMOUNT_OFF' ? 'FIXED_AMOUNT' : 'PERCENTAGE';
    const displayValue = gdType === 'FREE' ? 100 : gdValue;

    return {
      discountId: discount.id,
      code: discount.code!,
      title: discount.title ?? null,
      type: discount.type,
      valueType: displayValueType,
      value: displayValue,
      discountAmount: amount,
    };
  }

  async incrementUsedCount(id: string): Promise<void> {
    await this.discountRepo.incrementUsedCount(id);
  }

  /**
   * Enforce numeric bounds on discount values. PERCENTAGE must be in
   * [0, 100] — anything above would refund more than the customer paid.
   * FIXED must be non-negative — negative would add to the order total.
   */
  private validateDiscountValue(
    valueType: string | null | undefined,
    value: number | null | undefined,
  ): void {
    if (value === null || value === undefined) return;
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new BadRequestAppException('Discount value must be a number');
    }
    if (n < 0) {
      throw new BadRequestAppException('Discount value cannot be negative');
    }
    if ((valueType ?? 'PERCENTAGE') === 'PERCENTAGE' && n > 100) {
      throw new BadRequestAppException(
        'PERCENTAGE discount value must be between 0 and 100',
      );
    }
  }
}
