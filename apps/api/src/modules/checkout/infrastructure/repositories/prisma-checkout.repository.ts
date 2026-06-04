import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  ICheckoutRepository,
  CustomerAddressEntity,
  CreateAddressInput,
  UpdateAddressInput,
  CartWithItems,
  MasterOrderEntity,
  PlaceOrderTransactionInput,
  PlaceOrderTransactionResult,
  LegacyPlaceOrderTransactionResult,
} from '../../domain/repositories/checkout.repository.interface';
import { BadRequestAppException } from '../../../../core/exceptions';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import { attachReferralAttribution } from '../../../affiliate/application/attach-referral-attribution';

@Injectable()
export class PrismaCheckoutRepository implements ICheckoutRepository {
  constructor(
    private readonly prisma: PrismaService,
    // Phase 7 (PR 7.6) — paise-sibling dual-write for the order /
    // sub-order / commission writes inside the place-order transaction.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
  ) {}

  // ── Address operations ───────────────────────────────────────────────────

  async findAddressByIdAndCustomer(
    addressId: string,
    customerId: string,
  ): Promise<CustomerAddressEntity | null> {
    // Phase 63 (2026-05-22) — soft-deleted rows are invisible to
    // service-level ownership checks; the row is preserved for
    // historical order-detail lookups via a different query path.
    return this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId, deletedAt: null },
    }) as unknown as Promise<CustomerAddressEntity | null>;
  }

  async findAddressesByCustomer(customerId: string): Promise<CustomerAddressEntity[]> {
    // Phase 63 — list order is now [isDefault desc, createdAt desc]
    // so the storefront's preselect picks the actual default
    // (audit Gap #5). Soft-deleted rows excluded (audit Gap #3).
    return this.prisma.customerAddress.findMany({
      where: { customerId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    }) as unknown as Promise<CustomerAddressEntity[]>;
  }

  async countLiveAddressesForCustomer(customerId: string): Promise<number> {
    // Phase 63 (audit Gap #12) — used by the service-side per-
    // customer cap (default 50).
    return this.prisma.customerAddress.count({
      where: { customerId, deletedAt: null },
    });
  }

  async clearDefaultAddresses(customerId: string): Promise<void> {
    await this.prisma.customerAddress.updateMany({
      where: { customerId, isDefault: true, deletedAt: null },
      data: { isDefault: false },
    });
  }

  async createAddress(input: CreateAddressInput): Promise<CustomerAddressEntity> {
    // Phase 34 — resolve the GST state code at write time so the tax
    // engine + place-of-supply reader doesn't have to round-trip the
    // name-lookup at request time. Explicit input.stateCode wins;
    // otherwise look up by name. Lookup miss is fine — column is
    // nullable, the legacy state-code-map fallback still resolves it.
    const stateCode = await this.resolveStateCode(input.stateCode, input.state);
    return this.prisma.customerAddress.create({
      data: {
        customerId: input.customerId,
        fullName: input.fullName,
        phone: input.phone,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 || null,
        locality: input.locality || null,
        landmark: input.landmark || null,
        city: input.city,
        state: input.state,
        stateCode: stateCode,
        postalCode: input.postalCode,
        isDefault: input.isDefault || false,
        addressType: input.addressType ?? null,
      },
    }) as unknown as Promise<CustomerAddressEntity>;
  }

  async createAddressAtomic(input: CreateAddressInput): Promise<CustomerAddressEntity> {
    // Phase 63 (2026-05-22) — atomic clear-defaults + insert
    // (audit Gap #1). Pre-Phase-63 the service did this as two
    // separate awaits; two concurrent isDefault=true creates
    // could both pass through and leave the table with two
    // default rows. The partial unique index in the same
    // migration is the DB-level backstop.
    const stateCode = await this.resolveStateCode(input.stateCode, input.state);
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId: input.customerId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.create({
        data: {
          customerId: input.customerId,
          fullName: input.fullName,
          phone: input.phone,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2 || null,
          locality: input.locality || null,
          landmark: input.landmark || null,
          city: input.city,
          state: input.state,
          stateCode,
          postalCode: input.postalCode,
          isDefault: input.isDefault || false,
          addressType: input.addressType ?? null,
        },
      });
    }) as unknown as Promise<CustomerAddressEntity>;
  }

  async updateAddress(
    addressId: string,
    data: UpdateAddressInput,
  ): Promise<CustomerAddressEntity> {
    // Phase 34 — when `state` is supplied (caller changed the
    // state name), re-resolve stateCode unless caller explicitly
    // overrode it. Pure name change → automatic stateCode refresh.
    // Pure stateCode change (rare; admin override flow) → use it.
    //
    // Phase 63 (audit Gap #19) — treat explicit `null` stateCode
    // as "caller wants me to recompute from state". Pre-Phase-63
    // a caller passing `data.stateCode = null` skipped the
    // re-resolution (undefined-vs-null three-state ambiguity);
    // now null also triggers the recompute when state is set.
    let resolvedStateCode: string | null | undefined = data.stateCode;
    const stateCodeWasOmittedOrCleared =
      resolvedStateCode === undefined || resolvedStateCode === null;
    if (stateCodeWasOmittedOrCleared && data.state !== undefined) {
      resolvedStateCode = await this.resolveStateCode(undefined, data.state);
    }
    const finalData: Record<string, unknown> = { ...data };
    if (resolvedStateCode !== undefined) {
      finalData.stateCode = resolvedStateCode;
    }
    return this.prisma.customerAddress.update({
      where: { id: addressId },
      data: finalData,
    }) as unknown as Promise<CustomerAddressEntity>;
  }

  async updateAddressAtomic(
    addressId: string,
    customerId: string,
    data: UpdateAddressInput,
  ): Promise<CustomerAddressEntity> {
    // Phase 63 — atomic clear-defaults + update (audit Gap #1).
    let resolvedStateCode: string | null | undefined = data.stateCode;
    const stateCodeWasOmittedOrCleared =
      resolvedStateCode === undefined || resolvedStateCode === null;
    if (stateCodeWasOmittedOrCleared && data.state !== undefined) {
      resolvedStateCode = await this.resolveStateCode(undefined, data.state);
    }
    const finalData: Record<string, unknown> = { ...data };
    if (resolvedStateCode !== undefined) {
      finalData.stateCode = resolvedStateCode;
    }
    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.customerAddress.updateMany({
          where: {
            customerId,
            isDefault: true,
            deletedAt: null,
            NOT: { id: addressId },
          },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.update({
        where: { id: addressId },
        data: finalData,
      });
    }) as unknown as Promise<CustomerAddressEntity>;
  }

  /**
   * Phase 34 — resolve a CBIC 2-digit GST state code:
   *   - Explicit `explicit` value wins (when it matches the 2-digit
   *     pattern; otherwise dropped — never persist a non-canonical
   *     string as stateCode).
   *   - Else look up by free-text name against india_states with
   *     case-insensitive whitespace-tolerant match. Identical SQL
   *     to the backfill so writes and backfilled rows stay aligned.
   *   - Else return null. Column is nullable; legacy fallback in
   *     tax/domain/state-code-map.ts can still resolve at read time.
   */
  private async resolveStateCode(
    explicit: string | null | undefined,
    name: string | undefined,
  ): Promise<string | null> {
    if (explicit !== undefined && explicit !== null) {
      const trimmed = explicit.trim();
      if (/^[0-9]{2}$/.test(trimmed)) return trimmed;
    }
    if (!name) return null;
    const trimmedName = name.trim();
    if (!trimmedName) return null;
    // Same case-insensitive match the backfill uses.
    const row = await (this.prisma as any).indiaState.findFirst({
      where: {
        stateName: { equals: trimmedName, mode: 'insensitive' },
        isActive: true,
      },
      select: { gstStateCode: true },
    });
    return row?.gstStateCode ?? null;
  }

  async deleteAddress(addressId: string): Promise<void> {
    // Phase 63 (2026-05-22) — hard delete preserved for the
    // narrow back-compat case of the test harness; service-level
    // callers go through softDeleteAddressWithDefaultPromotion
    // (audit Gaps #2 + #3).
    await this.prisma.customerAddress.delete({
      where: { id: addressId },
    });
  }

  async softDeleteAddressWithDefaultPromotion(
    addressId: string,
    customerId: string,
  ): Promise<{ promoted: CustomerAddressEntity | null }> {
    // Phase 63 (2026-05-22) — soft delete + successor promotion
    // (audit Gaps #2 + #3). Single tx so the customer is never
    // left with zero defaults when at least one address remains.
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.customerAddress.findFirst({
        where: { id: addressId, customerId, deletedAt: null },
      });
      if (!target) return { promoted: null };

      await tx.customerAddress.update({
        where: { id: addressId },
        data: { deletedAt: new Date(), isDefault: false },
      });

      let promoted: any = null;
      if (target.isDefault) {
        // Find the most-recently-created LIVE address (excluding
        // the one we just soft-deleted) and flip it to default.
        const next = await tx.customerAddress.findFirst({
          where: {
            customerId,
            deletedAt: null,
            NOT: { id: addressId },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (next) {
          promoted = await tx.customerAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
      return { promoted };
    }) as unknown as Promise<{ promoted: CustomerAddressEntity | null }>;
  }

  async setDefaultAddress(
    addressId: string,
    customerId: string,
  ): Promise<{ previous: CustomerAddressEntity | null; current: CustomerAddressEntity }> {
    // Phase 63 (2026-05-22) — returns the previous default row too
    // so the UI can render a delta without re-listing (audit Gap
    // #22). Whole flow stays inside one $transaction.
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.customerAddress.findFirst({
        where: {
          customerId,
          isDefault: true,
          deletedAt: null,
          NOT: { id: addressId },
        },
      });
      if (previous) {
        await tx.customerAddress.update({
          where: { id: previous.id },
          data: { isDefault: false },
        });
      }
      const current = await tx.customerAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
      return { previous, current };
    }) as unknown as Promise<{
      previous: CustomerAddressEntity | null;
      current: CustomerAddressEntity;
    }>;
  }

  // ── Cart operations ──────────────────────────────────────────────────────

  async findCartWithCheckoutItems(customerId: string): Promise<CartWithItems | null> {
    return this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                basePrice: true,
                baseStock: true,
                baseSku: true,
                hasVariants: true,
                status: true,
                images: {
                  where: { isPrimary: true },
                  select: { url: true },
                  take: 1,
                },
              },
            },
            variant: {
              select: {
                id: true,
                title: true,
                price: true,
                stock: true,
                sku: true,
                status: true,
                images: {
                  select: { url: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
  }

  async findCartWithLegacyItems(customerId: string): Promise<CartWithItems | null> {
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            product: {
              include: {
                seller: { select: { id: true, sellerShopName: true } },
                images: {
                  where: { isPrimary: true },
                  select: { url: true },
                  take: 1,
                },
              },
            },
            variant: {
              select: {
                id: true,
                title: true,
                price: true,
                stock: true,
                sku: true,
                images: { select: { url: true }, take: 1 },
              },
            },
          },
        },
      },
    });
    // Cast at the Prisma boundary — the domain interface uses loose
    // types (any) for price fields, and the legacy query omits status
    // on variant.
    return cart as CartWithItems | null;
  }

  async deleteCartItemsByIds(cartItemIds: string[]): Promise<void> {
    await this.prisma.cartItem.deleteMany({
      where: { id: { in: cartItemIds } },
    });
  }

  // ── Order operations ─────────────────────────────────────────────────────

  async placeOrderTransaction(
    input: PlaceOrderTransactionInput,
  ): Promise<PlaceOrderTransactionResult> {
    // Phase 67 (2026-05-22) — idempotency fast-path (audit Gap #3).
    // If the service supplied a key and a MasterOrder with that key
    // already exists (prior retry committed), short-circuit and
    // return the prior placement's snapshot WITHOUT opening a tx.
    // The post-tx side effects (stock confirm, wallet debit,
    // Razorpay create) ran during the original attempt; the
    // service uses reusedExistingOrder to skip them on retry.
    if (input.idempotencyKey) {
      const existing = await this.prisma.masterOrder.findUnique({
        where: { idempotencyKey: input.idempotencyKey } as any,
        include: {
          subOrders: { select: { id: true, sellerId: true, franchiseId: true, fulfillmentNodeType: true, subTotal: true, items: { select: { quantity: true } } } },
        },
      });
      if (existing) {
        return {
          orderNumber: existing.orderNumber,
          masterOrderId: existing.id,
          totalAmount: Number(existing.totalAmount),
          itemCount: existing.itemCount,
          createdSubOrders: existing.subOrders.map((so) => ({
            subOrderId: so.id,
            sellerId: so.sellerId,
            franchiseId: so.franchiseId,
            fulfillmentNodeType: so.fulfillmentNodeType as 'SELLER' | 'FRANCHISE',
            nodeName: null,
            subTotal: Number(so.subTotal),
            itemCount: so.items.reduce((s, i) => s + i.quantity, 0),
          })),
          cartCleared: true,
          reusedExistingOrder: true,
        };
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // ── Server-side price validation ─────────────────────────────────
      // The client (cart / checkout session) supplies unitPrice for each
      // line item. We MUST re-fetch the current platform price from the
      // canonical product/variant rows here and reject if anything has
      // drifted by more than 1 paisa (rounding tolerance). This closes a
      // price-spoofing vector and also protects customers from stale
      // higher prices when an admin lowers a price between cart-add and
      // checkout — both directions are rejected.
      //
      // Phase 67 (audit Gap #12) — compare in paise. ₹0.01 in Number
      // arithmetic occasionally drifts (0.1+0.2 ≠ 0.3 on doubles); the
      // paise integer compare is exact.
      const PRICE_TOLERANCE_PAISE = 1n;
      const allLineItems = Object.values(input.fulfillmentGroups).flatMap(
        (g) => g.items,
      );
      const productIds = Array.from(
        new Set(allLineItems.map((i) => i.productId)),
      );
      const variantIds = Array.from(
        new Set(
          allLineItems
            .map((i) => i.variantId)
            .filter((id): id is string => !!id),
        ),
      );

      const [productRows, variantRows] = await Promise.all([
        tx.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            basePrice: true,
            status: true,
            // Phase 70 (audit Gap #15) — tax config snapshot fields.
            // Read inside the tx so OrderItemTaxConfigSnapshot is
            // populated from the same committed values the price
            // check used; the post-tx TaxSnapshotService reads
            // these from the snapshot row, never re-queries live.
            hsnCode: true,
            gstRateBps: true,
            supplyTaxability: true,
            taxInclusivePricing: true,
            cessRateBps: true,
            defaultUqcCode: true,
            productSource: true,
          },
        }),
        variantIds.length > 0
          ? tx.productVariant.findMany({
              where: { id: { in: variantIds } },
              select: {
                id: true,
                price: true,
                // Phase 67 (audit Gap #19) — also re-check the variant
                // is ACTIVE. Pre-Phase-67 the tx selected `price` only;
                // a variant deactivated between cart-add and place-order
                // slipped through and ended up on an order. The
                // ProductVariant.status enum has VARIANT_ACTIVE /
                // INACTIVE values; we accept only ACTIVE.
                status: true,
                // Phase 70 (audit Gap #15) — variant tax overrides.
                hsnCodeOverride: true,
                gstRateBpsOverride: true,
                taxInclusivePricingOverride: true,
                uqcCodeOverride: true,
              },
            })
          : Promise.resolve([] as Array<{
              id: string;
              price: any;
              status: string;
              hsnCodeOverride: string | null;
              gstRateBpsOverride: number | null;
              taxInclusivePricingOverride: boolean | null;
              uqcCodeOverride: string | null;
            }>),
      ]);

      const productById = new Map(productRows.map((p) => [p.id, p]));
      const variantById = new Map(variantRows.map((v) => [v.id, v]));

      for (const item of allLineItems) {
        const product = productById.get(item.productId);
        if (!product) {
          throw new BadRequestAppException(
            `Product ${item.productId} no longer exists`,
          );
        }
        if (product.status !== 'ACTIVE') {
          throw new BadRequestAppException(
            `Product is no longer available — please refresh your cart`,
          );
        }

        let canonicalListPricePaise: bigint;
        if (item.variantId) {
          const variant = variantById.get(item.variantId);
          if (!variant) {
            throw new BadRequestAppException(
              `Variant ${item.variantId} no longer exists`,
            );
          }
          // Phase 67 (audit Gap #19) — variant status gate.
          if (variant.status !== 'ACTIVE') {
            throw new BadRequestAppException(
              `Selected variant of "${item.productTitle}" is no longer available — please refresh your cart`,
            );
          }
          canonicalListPricePaise = BigInt(Math.round(Number(variant.price ?? 0) * 100));
        } else {
          canonicalListPricePaise = BigInt(Math.round(Number(product.basePrice ?? 0) * 100));
        }

        // Phase 44 (2026-05-21) — server-side price validation must
        // compare against the tier-adjusted price, not raw list. The
        // checkout caller passes appliedListUnitPrice when a tier
        // applied; we accept item.unitPrice as long as it equals
        // canonical (list with no tier) OR matches the snapshot's
        // listUnitPrice within tolerance (tier was applied; the cart
        // already redirected through the resolver so item.unitPrice
        // is effective price, not list).
        //
        // Phase 67 (audit Gap #12) — exact paise compare.
        const expectedListPricePaise = item.appliedListUnitPrice !== null && item.appliedListUnitPrice !== undefined
          ? BigInt(Math.round(item.appliedListUnitPrice * 100))
          : canonicalListPricePaise;
        const listDriftPaise = expectedListPricePaise > canonicalListPricePaise
          ? expectedListPricePaise - canonicalListPricePaise
          : canonicalListPricePaise - expectedListPricePaise;
        if (listDriftPaise > PRICE_TOLERANCE_PAISE) {
          const wasRupees = (Number(expectedListPricePaise) / 100).toFixed(2);
          const nowRupees = (Number(canonicalListPricePaise) / 100).toFixed(2);
          throw new BadRequestAppException(
            `Price for "${item.productTitle}" has changed (was ₹${wasRupees}, now ₹${nowRupees}). Please refresh your cart and try again.`,
          );
        }
        // If a tier was applied, item.unitPrice may legitimately be
        // less than canonicalListPrice — only reject when it's higher
        // than the list price (signals price-spoofing upward).
        const itemUnitPricePaise = BigInt(Math.round(item.unitPrice * 100));
        if (itemUnitPricePaise > canonicalListPricePaise + PRICE_TOLERANCE_PAISE) {
          throw new BadRequestAppException(
            `Price for "${item.productTitle}" exceeds the listed amount. Please refresh your cart and try again.`,
          );
        }
      }

      // Generate order number. Phase 69 (2026-05-22) — Phase 67
      // audit Gaps #17 + #18: switched from a single-row upsert
      // (which serialised every concurrent order on a row lock) to
      // a Postgres SEQUENCE. nextval() is non-transactional and
      // lock-free; the value increments globally even if the
      // surrounding tx rolls back (a known-and-accepted property
      // of Postgres sequences — leaves gaps, never duplicates).
      //
      // Format unchanged (`SM${year}${0001…}`) so existing parsers
      // and customer-facing displays stay valid. Numbers above 9999
      // naturally grow to 5+ digits — the padStart only adds
      // leading zeros, doesn't truncate.
      const seqRows = await tx.$queryRaw<{ nextval: bigint }[]>`
        SELECT nextval('order_number_seq') AS nextval
      `;
      const seqValue = Number(seqRows[0]!.nextval);
      const year = new Date().getFullYear();
      const orderNumber = `SM${year}${String(seqValue).padStart(4, '0')}`;

      const paymentMethod = input.paymentMethod ?? 'COD';
      const isOnline = paymentMethod === 'ONLINE';

      // Phase 67 (audit Gap #20) — re-check tax profile ownership
      // INSIDE the tx so a profile deleted between the service-side
      // pre-check and the order commit is caught. Best-effort: a
      // missing profile is dropped (tax-document service tolerates
      // a null id), only an owned-by-another-customer profile
      // triggers a hard reject.
      if (input.selectedTaxProfileId) {
        const profile = await tx.customerTaxProfile.findUnique({
          where: { id: input.selectedTaxProfileId },
          select: { customerId: true },
        });
        if (profile && profile.customerId !== input.customerId) {
          throw new BadRequestAppException(
            'Selected tax profile does not belong to this customer',
          );
        }
      }

      // Create master order. ONLINE orders start in PENDING_PAYMENT until
      // the frontend confirms the Razorpay payment; COD orders go straight
      // to PLACED.
      //
      // Phase 67 (audit Gap #3) — persist the deterministic
      // idempotencyKey computed by the service. The partial unique
      // index on master_orders(idempotency_key) is the DB-level
      // backstop for a retry firing after the fast-path findUnique
      // window. P2002 here means another in-flight tx committed
      // first; we map it to a re-read of the existing row.
      // Phase 68 (audit Gap #13) — verification SLA deadline. COD
      // orders go straight to PLACED, so the deadline starts ticking
      // immediately. ONLINE orders start in PENDING_PAYMENT and will
      // be stamped when payment-verified flips them to PLACED — we
      // still set a tentative deadline here so a PAID order without
      // a separate stamp path still has a value (the verify-payment
      // path will rewrite it relative to PAID time).
      const verificationSlaMinutes = Math.max(
        1,
        Number(process.env.VERIFICATION_SLA_MINUTES ?? 60),
      );
      const verificationDeadlineAt = new Date(
        Date.now() + verificationSlaMinutes * 60 * 1000,
      );

      let masterOrder;
      try {
        masterOrder = await tx.masterOrder.create({
          data: this.moneyDualWrite.applyPaise('masterOrder', {
            orderNumber,
            customerId: input.customerId,
            shippingAddressSnapshot: input.addressSnapshot,
            // .toFixed(2) gives a Decimal-string the helper's toPaise
            // can convert exactly; raw JS Numbers from upstream cart-sum
            // arithmetic may be fractional and toPaise rejects those.
            totalAmount: Number(input.totalAmount).toFixed(2),
            paymentMethod,
            paymentStatus: isOnline ? 'PENDING' : 'PENDING',
            orderStatus: isOnline ? 'PENDING_PAYMENT' : 'PLACED',
            itemCount: input.itemCount,
            discountCode: input.discountCode ?? null,
            discountAmount: Number(input.discountAmount ?? 0).toFixed(2),
            // Shipping snapshot (v1). Stored both as FK + name so the
            // order detail still renders correctly if the option is
            // renamed or soft-deleted later.
            shippingOptionId: input.shippingOptionId ?? null,
            shippingOptionName: input.shippingOptionName ?? null,
            shippingFeeInPaise: input.shippingFeeInPaise ?? 0n,
            // Phase 37 — checkout-picked B2B tax profile snapshot.
            selectedTaxProfileId: input.selectedTaxProfileId ?? null,
            // Phase 67 (audit Gaps #3 + #9).
            idempotencyKey: input.idempotencyKey ?? null,
            sourceCartId: input.sourceCartId ?? null,
            // Phase 68 (audit Gap #13) — real verification SLA deadline.
            verificationDeadlineAt,
          } as any),
        });
      } catch (err: any) {
        if (err?.code === 'P2002' && input.idempotencyKey) {
          // Idempotency race lost — surface a typed marker so the
          // service layer maps to a re-read instead of a 500.
          throw Object.assign(
            new Error('IDEMPOTENCY_CONFLICT'),
            { code: 'IDEMPOTENCY_CONFLICT', idempotencyKey: input.idempotencyKey },
          );
        }
        throw err;
      }

      // Affiliate attribution — write the ReferralAttribution row in
      // the same transaction so the (order ← affiliate) binding is
      // atomic with order creation. The actual commission is NOT
      // created here; that fires on payments.payment.captured (so
      // unpaid orders don't accrue affiliate earnings, per SRS §8.5).
      //
      // Phase 159c (audit M2/M3) — delegates to the shared
      // attachReferralAttribution helper (single source of truth with the
      // unified-discount redemption hook). It takes the FOR UPDATE lock,
      // re-checks maxUses + perUserLimit, increments usedCount, and writes
      // the (P2002-idempotent) row. Cap overshoot throws → unwinds this tx.
      if (input.affiliateAttribution) {
        const attribution = input.affiliateAttribution;
        await attachReferralAttribution(tx, {
          orderId: masterOrder.id,
          affiliateId: attribution.affiliateId,
          source: attribution.source,
          code: attribution.code,
          customerId: attribution.customerId ?? input.customerId,
          couponCodeId: attribution.couponCodeId,
        });
      }

      // Phase 67 (audit Gaps #6 + #22) — sub-order accept deadline.
      // Pre-Phase-67 acceptDeadlineAt was set to NULL at create time
      // and stamped later by the manual /process endpoint, so any
      // sub-order on an order that never went through that path had
      // a NULL deadline and the accept-deadline sweeper had nothing
      // to act on. We now stamp it at create time with the same
      // 24h window the orders service uses; admin /process is still
      // free to overwrite for the manual-routing case.
      const ACCEPT_SLA_HOURS_DEFAULT = 24;

      // Create sub-orders per fulfillment node (seller or franchise)
      const createdSubOrders: PlaceOrderTransactionResult['createdSubOrders'] = [];
      for (const [_groupKey, group] of Object.entries(input.fulfillmentGroups)) {
        let subTotal = 0;
        const orderItemsData = group.items.map((item) => {
          subTotal += item.totalPrice;
          return {
            productId: item.productId,
            variantId: item.variantId,
            productTitle: item.productTitle,
            variantTitle: item.variantTitle,
            sku: item.sku,
            masterSku: item.masterSku,
            imageUrl: item.imageUrl,
            // Phase 67 (audit Gap #23) — Cloudinary public id snapshot
            // so the UI can rebuild the URL after a regeneration.
            // Null until ProductImage carries publicId end-to-end.
            imagePublicId: item.imagePublicId ?? null,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            totalPrice: item.totalPrice,
            // Phase B (P0.1) — paise mirrors of the decimal fields.
            unitPriceInPaise: BigInt(Math.round(Number(item.unitPrice) * 100)),
            totalPriceInPaise: BigInt(Math.round(Number(item.totalPrice) * 100)),
            // Phase 44 (2026-05-21) — pricing-tier snapshot. NULL when
            // no tier qualified — refund/dispute flow treats null as
            // "paid full list price". Applied tier id references
            // ProductPricingTier; SetNull on delete.
            appliedPricingTierId: item.appliedPricingTierId ?? null,
            appliedDiscountPercent: item.appliedDiscountPercent ?? null,
            appliedFixedUnitPrice: item.appliedFixedUnitPrice ?? null,
            appliedListUnitPrice: item.appliedListUnitPrice ?? null,
            // stockReservationId is populated by the service AFTER
            // catalogFacade.confirmReservation succeeds (audit Gap
            // #10). Null at create time.
          };
        });

        const slaHours = group.acceptSlaHours ?? ACCEPT_SLA_HOURS_DEFAULT;
        const acceptDeadlineAt = new Date(
          Date.now() + slaHours * 60 * 60 * 1000,
        );

        const subOrder = await tx.subOrder.create({
          data: {
            masterOrderId: masterOrder.id,
            sellerId: group.nodeType === 'SELLER' ? group.nodeId : null,
            franchiseId: group.nodeType === 'FRANCHISE' ? group.nodeId : null,
            fulfillmentNodeType: group.nodeType,
            subTotal,
            paymentStatus: 'PENDING',
            fulfillmentStatus: 'UNFULFILLED',
            acceptStatus: 'OPEN',
            // Phase 3 Delhivery wiring (2026-06-02) — default new sub-orders
            // to DELHIVERY so the resolver picks the Delhivery adapter and
            // the auto-book handler fires when the node marks PACKED. This is
            // the intended end-state (Delhivery replaces self-delivery).
            deliveryMethod: 'DELHIVERY',
            // Phase 67 (audit Gaps #6 + #22) — populated at create.
            acceptDeadlineAt,
            commissionRateSnapshot: group.commissionRateSnapshot ?? null,
            items: { create: orderItemsData },
          },
        });

        createdSubOrders.push({
          subOrderId: subOrder.id,
          sellerId: group.nodeType === 'SELLER' ? group.nodeId : null,
          franchiseId: group.nodeType === 'FRANCHISE' ? group.nodeId : null,
          fulfillmentNodeType: group.nodeType,
          nodeName: group.nodeName,
          subTotal,
          itemCount: group.items.reduce((s, i) => s + i.quantity, 0),
        });

        // Phase 70 (audit Gap #15) — tax-config snapshot per OrderItem.
        // Pulls the OrderItem ids we just nested-created and writes
        // a snapshot row carrying the resolved (variant ?? product)
        // tax config. The post-tx TaxSnapshotService reads from
        // this row instead of re-querying live product/variant —
        // mid-flow admin edits to gstRateBps / hsnCode can no
        // longer drift the snapshot away from what the customer
        // was actually charged.
        const createdItems = await tx.orderItem.findMany({
          where: { subOrderId: subOrder.id },
          select: {
            id: true,
            productId: true,
            variantId: true,
          },
        });
        const taxSnapshotRows = createdItems
          .map((oi) => {
            const product = productById.get(oi.productId);
            if (!product) return null;
            const variant = oi.variantId ? variantById.get(oi.variantId) : undefined;
            // Resolve overrides: variant value wins when non-null,
            // otherwise fall back to product.
            const hsnCode = variant?.hsnCodeOverride ?? (product as any).hsnCode ?? null;
            const gstRateBps = variant?.gstRateBpsOverride ?? (product as any).gstRateBps ?? 0;
            const priceIncludesTax =
              variant?.taxInclusivePricingOverride !== null && variant?.taxInclusivePricingOverride !== undefined
                ? variant.taxInclusivePricingOverride
                : (product as any).taxInclusivePricing ?? true;
            const uqcCode = variant?.uqcCodeOverride ?? (product as any).defaultUqcCode ?? null;
            return {
              orderItemId: oi.id,
              hsnCode,
              gstRateBps,
              supplyTaxability: ((product as any).supplyTaxability ?? 'TAXABLE') as string,
              priceIncludesTax: !!priceIncludesTax,
              cessRateBps: (product as any).cessRateBps ?? 0,
              uqcCode,
              productSource: (product as any).productSource ?? null,
              sourcedFromVariant: !!variant && (
                variant.hsnCodeOverride !== null ||
                variant.gstRateBpsOverride !== null ||
                variant.taxInclusivePricingOverride !== null ||
                variant.uqcCodeOverride !== null
              ),
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);
        if (taxSnapshotRows.length > 0) {
          await tx.orderItemTaxConfigSnapshot.createMany({
            data: taxSnapshotRows,
          });
        }
      }

      // Clear cart. Phase 67 (audit Gap #9) — we capture the cart id
      // pre-delete so the upstream service can record it onto the
      // master order via the sourceCartId path.
      //
      // Phase 69 (audit Gap #8) — snapshot the cart line items as JSON
      // BEFORE the deleteMany. The live CartItem rows are still
      // deleted (we don't want a customer to "re-checkout" the same
      // cart by accident), but the snapshot gives the order-cancel
      // + cart-restore path something to rehydrate from. Stored on
      // MasterOrder.sourceCartSnapshot — read-only, never edited.
      const cart = await tx.cart.findUnique({
        where: { customerId: input.customerId },
        select: {
          id: true,
          items: {
            select: {
              id: true,
              productId: true,
              variantId: true,
              quantity: true,
              savedForLater: true,
              unitPriceAtAddInPaise: true,
              appliedPricingTierId: true,
              appliedDiscountPercent: true,
              appliedFixedUnitPrice: true,
              appliedListUnitPrice: true,
              createdAt: true,
            },
          },
        },
      });
      let cartCleared = false;
      if (cart) {
        // Snapshot first, then delete.
        if (cart.items.length > 0) {
          await tx.masterOrder.update({
            where: { id: masterOrder.id },
            data: {
              sourceCartSnapshot: {
                cartId: cart.id,
                archivedAt: new Date().toISOString(),
                items: cart.items.map((it) => ({
                  cartItemId: it.id,
                  productId: it.productId,
                  variantId: it.variantId,
                  quantity: it.quantity,
                  savedForLater: it.savedForLater,
                  unitPriceAtAddInPaise:
                    it.unitPriceAtAddInPaise !== null
                      ? it.unitPriceAtAddInPaise.toString()
                      : null,
                  appliedPricingTierId: it.appliedPricingTierId,
                  appliedDiscountPercent:
                    it.appliedDiscountPercent !== null
                      ? Number(it.appliedDiscountPercent)
                      : null,
                  appliedFixedUnitPrice:
                    it.appliedFixedUnitPrice !== null
                      ? Number(it.appliedFixedUnitPrice)
                      : null,
                  appliedListUnitPrice:
                    it.appliedListUnitPrice !== null
                      ? Number(it.appliedListUnitPrice)
                      : null,
                  createdAt: it.createdAt.toISOString(),
                })),
              },
            } as any,
          });
        }
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        cartCleared = true;
        // Best-effort: backfill sourceCartId here if the service
        // didn't pre-resolve it (the service path normally does).
        if (!input.sourceCartId) {
          await tx.masterOrder.update({
            where: { id: masterOrder.id },
            data: { sourceCartId: cart.id } as any,
          });
        }
      }

      return {
        orderNumber,
        masterOrderId: masterOrder.id,
        totalAmount: input.totalAmount,
        itemCount: input.itemCount,
        createdSubOrders,
        cartCleared,
        reusedExistingOrder: false,
      };
    });
  }

  // Phase 67 (audit Gap #10) — post-confirmation linkage. The service
  // calls this once catalogFacade.confirmReservation has succeeded so
  // refund / dispute lookups can resolve OrderItem ↔ StockReservation
  // by id rather than a (productId, variantId, mappingId) probe. Map
  // is { orderItemId: stockReservationId }; rows not in the map are
  // left untouched (franchise items + COD legacy etc.).
  async linkStockReservationsToOrderItems(
    masterOrderId: string,
    linkMap: Record<string, string>,
  ): Promise<void> {
    const entries = Object.entries(linkMap);
    if (entries.length === 0) return;
    // updateMany doesn't support per-row values; do small individual
    // updates. The volume per order is bounded by line count (~tens).
    await this.prisma.$transaction(
      entries.map(([orderItemId, stockReservationId]) =>
        this.prisma.orderItem.updateMany({
          where: { id: orderItemId, subOrder: { masterOrderId } },
          data: { stockReservationId } as any,
        }),
      ),
    );
  }

  // Phase 67 (audit Gaps #1 + #5) — flips finalizedAt once all
  // post-tx side effects have either committed or been
  // compensated. The recovery cron filters on finalizedAt IS NULL
  // AND created_at < threshold so a stuck order surfaces for
  // ops review instead of silently sitting incomplete.
  async markOrderFinalized(masterOrderId: string): Promise<void> {
    await this.prisma.masterOrder.updateMany({
      where: { id: masterOrderId, finalizedAt: null } as any,
      data: { finalizedAt: new Date() } as any,
    });
  }

  // Phase 67 (audit Gap #3) — re-read on idempotency conflict. The
  // partial unique index on master_orders(idempotency_key) is the
  // backstop; this helper is what placeOrder calls after catching
  // the IDEMPOTENCY_CONFLICT marker the tx throws.
  async findOrderByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PlaceOrderTransactionResult | null> {
    const existing = await this.prisma.masterOrder.findUnique({
      where: { idempotencyKey } as any,
      include: {
        subOrders: { select: { id: true, sellerId: true, franchiseId: true, fulfillmentNodeType: true, subTotal: true, items: { select: { quantity: true } } } },
      },
    });
    if (!existing) return null;
    return {
      orderNumber: existing.orderNumber,
      masterOrderId: existing.id,
      totalAmount: Number(existing.totalAmount),
      itemCount: existing.itemCount,
      createdSubOrders: existing.subOrders.map((so) => ({
        subOrderId: so.id,
        sellerId: so.sellerId,
        franchiseId: so.franchiseId,
        fulfillmentNodeType: so.fulfillmentNodeType as 'SELLER' | 'FRANCHISE',
        nodeName: null,
        subTotal: Number(so.subTotal),
        itemCount: so.items.reduce((s, i) => s + i.quantity, 0),
      })),
      cartCleared: true,
      reusedExistingOrder: true,
    };
  }

  async legacyPlaceOrderTransaction(
    customerId: string,
    cart: CartWithItems,
    addressSnapshot: Record<string, any>,
  ): Promise<LegacyPlaceOrderTransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      // Validate stock for all items
      for (const item of cart.items) {
        if (item.variant) {
          const variant = await tx.productVariant.findUnique({
            where: { id: item.variant.id },
          });
          if (!variant || variant.stock < item.quantity) {
            throw new BadRequestAppException(
              `Insufficient stock for "${item.product.title}" (${item.variant.title || 'variant'})`,
            );
          }
        } else {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });
          if (!product || (product.baseStock ?? 0) < item.quantity) {
            throw new BadRequestAppException(
              `Insufficient stock for "${item.product.title}"`,
            );
          }
        }
      }

      // Generate order number atomically
      const seq = await tx.orderSequence.update({
        where: { id: 1 },
        data: { lastNumber: { increment: 1 } },
      });
      const year = new Date().getFullYear();
      const orderNumber = `SM${year}${String(seq.lastNumber).padStart(4, '0')}`;

      // Group items by seller
      const sellerGroups: Record<string, Array<(typeof cart.items)[number]>> = {};
      for (const item of cart.items) {
        const sellerId = item.product.seller?.id || 'unknown';
        if (!sellerGroups[sellerId]) sellerGroups[sellerId] = [];
        sellerGroups[sellerId].push(item);
      }

      // Calculate total
      let totalAmount = 0;
      let itemCount = 0;
      for (const item of cart.items) {
        const price = item.variant
          ? Number(item.variant.price)
          : Number(item.product.basePrice || 0);
        totalAmount += price * item.quantity;
        itemCount += item.quantity;
      }

      // Create master order with status PLACED (awaits admin verification)
      const masterOrder = await tx.masterOrder.create({
        data: {
          orderNumber,
          customerId,
          shippingAddressSnapshot: addressSnapshot,
          totalAmount,
          paymentMethod: 'COD',
          paymentStatus: 'PENDING',
          orderStatus: 'PLACED',
          itemCount,
        },
      });

      // Create sub-orders per seller
      for (const [sellerId, items] of Object.entries(sellerGroups)) {
        let subTotal = 0;
        const orderItemsData = items.map((item) => {
          const price = item.variant
            ? Number(item.variant.price)
            : Number(item.product.basePrice || 0);
          const lineTotal = price * item.quantity;
          subTotal += lineTotal;

          const imageUrl =
            item.variant?.images?.[0]?.url ||
            item.product.images?.[0]?.url ||
            null;

          return {
            productId: item.productId,
            variantId: item.variantId,
            productTitle: item.product.title,
            variantTitle: item.variant?.title || null,
            sku: item.variant?.sku || item.product.baseSku || null,
            masterSku: item.variant?.sku || item.product.baseSku || null,
            imageUrl,
            unitPrice: price,
            quantity: item.quantity,
            totalPrice: lineTotal,
            // Phase B (P0.1) — paise mirrors. See companion site above
            // for context; the allocation engine reads these BigInts.
            unitPriceInPaise: BigInt(Math.round(Number(price) * 100)),
            totalPriceInPaise: BigInt(Math.round(Number(lineTotal) * 100)),
          };
        });

        await tx.subOrder.create({
          data: this.moneyDualWrite.applyPaise('subOrder', {
            masterOrderId: masterOrder.id,
            sellerId,
            // Same Decimal-string conversion as the masterOrder.create
            // above — subTotal accumulates from item totals as a JS
            // Number, may be fractional.
            subTotal: Number(subTotal).toFixed(2),
            paymentStatus: 'PENDING',
            fulfillmentStatus: 'UNFULFILLED',
            acceptStatus: 'OPEN',
            // Phase 3 Delhivery wiring (2026-06-02) — see modern path above.
            deliveryMethod: 'DELHIVERY',
            items: {
              create: orderItemsData,
            },
          }),
          include: { items: true },
        });
      }

      // Decrement stock
      for (const item of cart.items) {
        if (item.variant) {
          await tx.productVariant.update({
            where: { id: item.variant.id },
            data: { stock: { decrement: item.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: item.productId },
            data: { baseStock: { decrement: item.quantity } },
          });
        }
      }

      // Clear cart
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      return { orderNumber, totalAmount, itemCount };
    });
  }

  // ── Order queries ────────────────────────────────────────────────────────

  async findMasterOrderWithSubOrders(
    orderNumber: string,
    customerId: string,
  ): Promise<MasterOrderEntity | null> {
    const order = await this.prisma.masterOrder.findFirst({
      where: { orderNumber, customerId },
      include: {
        subOrders: {
          include: { items: true },
        },
      },
    });
    if (!order) return null;
    // Map Prisma Decimal fields to plain numbers at the boundary
    return {
      ...order,
      totalAmount: Number(order.totalAmount),
      subOrders: order.subOrders.map((so) => ({
        ...so,
        subTotal: Number(so.subTotal),
      })),
    } as MasterOrderEntity;
  }

  // ── Cancel operations ────────────────────────────────────────────────────

  async cancelOrderTransaction(order: MasterOrderEntity): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Update master order
      await tx.masterOrder.update({
        where: { id: order.id },
        data: { paymentStatus: 'CANCELLED', orderStatus: 'CANCELLED' },
      });

      // Update all sub-orders
      for (const so of order.subOrders) {
        await tx.subOrder.update({
          where: { id: so.id },
          data: {
            paymentStatus: 'CANCELLED',
            acceptStatus: 'REJECTED',
            // Phase 75 (Phase 73 audit Gap #10) — keep
            // commissionProcessed: true so the settlement sweep
            // skips this row; the new commissionDecision column
            // records the actual reason.
            commissionProcessed: true,
            commissionDecision: 'NOT_APPLICABLE' as any,
          },
        });

        // Restore stock for each item
        for (const item of so.items) {
          if (item.variantId) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          } else {
            await tx.product.update({
              where: { id: item.productId },
              data: { baseStock: { increment: item.quantity } },
            });
          }

          // Also restore SellerProductMapping.stockQty
          if (so.sellerId) {
            const mapping = await tx.sellerProductMapping.findFirst({
              where: {
                sellerId: so.sellerId,
                productId: item.productId,
                variantId: item.variantId ?? null,
              },
            });
            if (mapping) {
              await tx.sellerProductMapping.update({
                where: { id: mapping.id },
                data: { stockQty: { increment: item.quantity } },
              });
            }
          }

          // Refund commission if already processed. Full cancel reverses the
          // entire margin and drops an audit row so settlement reconciliation
          // sees the reversal event, not just a silently-mutated running total
          // — mirrors return-commission-reversal.service.ts (seller path).
          const commissionRecord = await tx.commissionRecord.findUnique({
            where: { orderItemId: item.id },
          });
          if (commissionRecord) {
            await tx.commissionRecord.update({
              where: { id: commissionRecord.id },
              data: this.moneyDualWrite.applyPaise('commissionRecord', {
                refundedAdminEarning: commissionRecord.adminEarning,
                status: 'REFUNDED',
              }),
            });
            await tx.commissionReversalRecord.create({
              data: this.moneyDualWrite.applyPaise('commissionReversalRecord', {
                commissionRecordId: commissionRecord.id,
                source: 'MANUAL',
                returnId: null,
                returnNumber: null,
                reversedQty: item.quantity,
                // commissionRecord.totalPrice and adminEarning are
                // Decimal-typed values read from the DB above, so the
                // helper's toPaise can convert exactly — no .toFixed
                // dance needed here.
                totalRefundAmount: commissionRecord.totalPrice,
                refundedAdminEarning: commissionRecord.adminEarning,
                actorType: 'SYSTEM',
                actorId: null,
                note: `Customer cancellation of order ${order.orderNumber}`,
              }),
            });
          }
        }
      }
    });
  }
}
