import { Inject, Injectable } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { Prisma } from '@prisma/client';
import {
  DiscountRepository,
  DISCOUNT_REPOSITORY,
} from '../../domain/repositories/discount.repository.interface';

@Injectable()
export class DiscountsService {
  constructor(
    @Inject(DISCOUNT_REPOSITORY)
    private readonly discountRepo: DiscountRepository,
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

  // Derive the current effective status from the date window, so a SCHEDULED
  // discount whose `startsAt` has passed shows as ACTIVE (and one past its
  // `endsAt` shows as EXPIRED) without needing a background job to rewrite
  // the stored label. DRAFT is preserved — it's the explicit disabled state.
  private withEffectiveStatus<T extends {
    status: string;
    startsAt: Date | string | null;
    endsAt: Date | string | null;
  }>(d: T): T {
    if (!d || d.status === 'DRAFT') return d;
    const now = new Date();
    const start = d.startsAt ? new Date(d.startsAt) : null;
    const end = d.endsAt ? new Date(d.endsAt) : null;
    let effective: string = d.status;
    if (start && start > now) effective = 'SCHEDULED';
    else if (end && end < now) effective = 'EXPIRED';
    else effective = 'ACTIVE';
    return { ...d, status: effective };
  }

  async create(data: any) {
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
      ...rest
    } = data;

    if (!type) throw new BadRequestAppException('Discount type is required');
    if (method === 'CODE' && !code?.trim())
      throw new BadRequestAppException('Discount code is required');
    if (method === 'AUTOMATIC' && !title?.trim())
      throw new BadRequestAppException('Discount title is required');

    // Guard against out-of-bounds values that would silently hand out
    // more than the product cost. The controller accepts a loose `any`
    // body (no DTO) so this validation lives here. A PERCENTAGE > 100
    // would refund the customer more than they paid; any negative would
    // add to the total instead of subtracting.
    this.validateDiscountValue(rest.valueType, rest.value);
    if (rest.getDiscountValue !== undefined && rest.getDiscountValue !== null) {
      this.validateDiscountValue(rest.getDiscountType, rest.getDiscountValue);
    }

    if (code?.trim()) {
      const existing = await this.discountRepo.findByCode(
        code.trim().toUpperCase(),
      );
      if (existing)
        throw new BadRequestAppException('Discount code already exists');
    }

    const now = new Date();
    const start = startsAt ? new Date(startsAt) : now;
    const end = endsAt ? new Date(endsAt) : null;
    if (end && end <= start) {
      throw new BadRequestAppException(
        'endsAt must be after startsAt — an always-expired discount cannot be created',
      );
    }
    let status: 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' = 'ACTIVE';
    if (start > now) status = 'SCHEDULED';
    if (end && end < now) status = 'EXPIRED';

    const discount = await this.discountRepo.create({
      code: code ? code.trim().toUpperCase() : null,
      title: title?.trim() || null,
      type,
      method: method || 'CODE',
      valueType: rest.valueType || 'PERCENTAGE',
      value: rest.value || 0,
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
    });

    if (productIds?.length) {
      await this.discountRepo.createProductLinks(
        discount.id,
        productIds,
        'APPLIES',
      );
    }
    if (collectionIds?.length) {
      await this.discountRepo.createCollectionLinks(
        discount.id,
        collectionIds,
        'APPLIES',
      );
    }
    if (buyProductIds?.length) {
      await this.discountRepo.createProductLinks(
        discount.id,
        buyProductIds,
        'BUY',
      );
    }
    if (getProductIds?.length) {
      await this.discountRepo.createProductLinks(
        discount.id,
        getProductIds,
        'GET',
      );
    }

    return discount;
  }

  async update(id: string, body: any) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');

    const { productIds, collectionIds, buyProductIds, getProductIds, startsAt, endsAt, ...fields } = body;
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

    for (const key of [
      'code',
      'title',
      'valueType',
      'value',
      'appliesTo',
      'minRequirement',
      'minRequirementValue',
      'maxUses',
      'onePerCustomer',
      'combineProduct',
      'combineOrder',
      'combineShipping',
      'status',
      'buyType',
      'buyValue',
      'buyItemsFrom',
      'getQuantity',
      'getItemsFrom',
      'getDiscountType',
      'getDiscountValue',
      'maxUsesPerOrder',
    ]) {
      if (fields[key] !== undefined) {
        data[key] =
          key === 'code' && fields[key]
            ? fields[key].trim().toUpperCase()
            : fields[key];
      }
    }
    if (startsAt !== undefined) data.startsAt = new Date(startsAt);
    if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null;

    const updated = await this.discountRepo.update(id, data);

    if (productIds !== undefined) {
      await this.discountRepo.deleteProductLinks(id, 'APPLIES');
      if (productIds.length) {
        await this.discountRepo.createProductLinks(id, productIds, 'APPLIES');
      }
    }
    if (collectionIds !== undefined) {
      await this.discountRepo.deleteCollectionLinks(id, 'APPLIES');
      if (collectionIds.length) {
        await this.discountRepo.createCollectionLinks(
          id,
          collectionIds,
          'APPLIES',
        );
      }
    }
    if (buyProductIds !== undefined) {
      await this.discountRepo.deleteProductLinks(id, 'BUY');
      if (buyProductIds.length) {
        await this.discountRepo.createProductLinks(id, buyProductIds, 'BUY');
      }
    }
    if (getProductIds !== undefined) {
      await this.discountRepo.deleteProductLinks(id, 'GET');
      if (getProductIds.length) {
        await this.discountRepo.createProductLinks(id, getProductIds, 'GET');
      }
    }
    return updated;
  }

  async delete(id: string) {
    const discount = await this.discountRepo.findById(id);
    if (!discount) throw new NotFoundAppException('Discount not found');
    await this.discountRepo.delete(id);
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
  ): Promise<{
    discountId: string;
    code: string;
    title: string | null;
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
      throw new BadRequestAppException('Invalid coupon code');
    }
    if (discount.method !== 'CODE') {
      throw new BadRequestAppException('This code cannot be applied manually');
    }
    // DRAFT is the explicit "disabled" state set by an admin — always reject.
    // For ACTIVE/SCHEDULED/EXPIRED the stored status can go stale (it's only
    // snapshotted at create/update time), so trust the date window as the
    // source of truth instead of the stored label.
    if (discount.status === 'DRAFT') {
      throw new BadRequestAppException('This coupon is no longer available');
    }
    if (discount.type === 'FREE_SHIPPING') {
      throw new BadRequestAppException(
        'Free-shipping coupons are not available — delivery is already free on this order.',
      );
    }
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
      } else {
        amount = value;
      }
      amount = Math.max(0, Math.min(amount, Number(subtotal)));
      amount = Math.round(amount * 100) / 100;
      return {
        discountId: discount.id,
        code: discount.code!,
        title: discount.title ?? null,
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
      if (
        discount.buyType === 'MIN_QUANTITY' &&
        isBuyEligible(it.productId) &&
        buyProductIds.size > 0 &&
        getProductIds.size > 0 &&
        buyProductIds.has(it.productId) &&
        getProductIds.has(it.productId)
      ) {
        availableQty = Math.max(0, availableQty - buyValueNum);
      }
      for (let i = 0; i < availableQty; i++) {
        perUnit.push({ unitPrice: Number(it.unitPrice) || 0, productId: it.productId });
      }
    }
    perUnit.sort((a, b) => a.unitPrice - b.unitPrice);
    const discounted = perUnit.slice(0, getQuantity);
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
