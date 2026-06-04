// Phase 9 of the GST/tax/invoice system — TaxDocumentService.
//
// Orchestrates the creation of a single legal tax document per
// SubOrder. The PDF rendering itself is intentionally out-of-scope
// for Phase 9 — `status` ends at `PDF_PENDING` and Phase 19's PDF
// retry processor turns HTML → PDF + uploads to S3.
//
// Sequence:
//   1. Idempotency: if a non-cancelled document already exists for
//      this SubOrder, return it. Same applies on retry.
//   2. Load SubOrderTaxSummary + lines (OrderItemTaxSnapshot rows).
//   3. Load seller / platform GSTIN context (legal name + address +
//      registration type) — supplier identity snapshot for Section 31.
//   4. Load customer + buyer GSTIN — recipient identity snapshot.
//   5. Decide documentType via `pickDocumentType`.
//   6. Allocate document number via DocumentSequenceService.
//   7. Compute round-off → grand total → amount-in-words.
//   8. Persist tax_documents + tax_document_lines in a transaction.
//   9. Mark status = PDF_PENDING (PDF rendered in Phase 19).
//   10. Emit `tax.document.generated` event for downstream (notifications,
//       ledger writers).
//
// See:
//   - docs/tax/CA.md §A Phase 9 log + §6.1 Section 31 hooks
//   - docs/tax/INVOICE_CANCELLATION_POLICY.md (status semantics)
//   - docs/tax/HSN_RATE_POLICY.md (HSN/UQC on lines)

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { BadRequestAppException } from '../../../../core/exceptions';
import { EWayBillService } from './eway-bill.service';
import { TaxModeService } from './tax-mode.service';
// Phase 90 (2026-05-23) — auto-classify hook (Gap #1).
import { EInvoiceService } from './einvoice.service';
import {
  DocumentSequenceService,
} from './document-sequence.service';
import {
  pickDocumentType,
  type DocumentTypePickerResult,
} from '../../domain/document-type-picker';
import { paiseToInvoiceWords } from '../../domain/amount-in-words';
import { computeInvoiceRoundOff } from '../../domain/round-off';
import {
  assertTransitionAllowed,
  isIssuedStatus,
} from '../../domain/tax-document-state-machine';
import {
  Prisma,
  type DocumentType,
  type GstRegistrationType,
  type SupplierType,
  type InvoiceType,
  type TaxDocumentStatus,
} from '@prisma/client';

export interface GenerateForSubOrderOptions {
  /**
   * If true, generates even when a non-cancelled document already
   * exists for this sub-order (creates a superseding document and
   * marks the prior one SUPERSEDED). Default false.
   */
  forceNew?: boolean;
  /**
   * Override the "system" actor for audit purposes (admin manual
   * triggers vs scheduled jobs).
   */
  actorId?: string | null;
}

export interface GenerateResult {
  document: { id: string; documentNumber: string; documentType: DocumentType };
  isNew: boolean;
  reason: string;
}

@Injectable()
export class TaxDocumentService {
  private readonly logger = new Logger(TaxDocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docSequence: DocumentSequenceService,
    private readonly ewayBill: EWayBillService,
    // Phase 45 (2026-05-21) — TaxModeService.report() now gates
    // invoice generation. Before Phase 45 the three modes
    // (OFF/AUDIT/STRICT) only controlled the PDF DRAFT watermark;
    // the underlying invoice always succeeded. Now STRICT throws on
    // missing-HSN / missing-rate / unverified-config and the
    // generation aborts before document_number is allocated.
    private readonly taxMode: TaxModeService,
    // Phase 90 (2026-05-23) — Gap #1 auto-classify hook. @Optional
    // because the legacy spec harnesses instantiate TaxDocumentService
    // directly without DI; e-invoice path is no-op when undefined.
    @Optional()
    private readonly einvoice?: EInvoiceService,
  ) {}

  /**
   * Phase 45 (2026-05-21) — invoice-generation pre-flight gate.
   *
   * For every product referenced by the snapshot rows, fetch the
   * current tax columns and emit a violation via TaxModeService.report()
   * for each missing/invalid field. Behaviour per mode:
   *   - OFF:    .report() is a no-op (silent).
   *   - AUDIT:  logs the violation, generation proceeds.
   *   - STRICT: throws TaxStrictModeViolationError, generation aborts.
   *
   * Closes audit gaps #2 (TaxModeService.report never invoked) and
   * #15 (invoice generation doesn't read tax mode for content gating).
   *
   * Uses a single product fetch keyed on the de-duplicated set of
   * productIds in the snapshot — no per-line N+1.
   */
  private async assertInvoiceLinesAreTaxReady(snapshots: ReadonlyArray<{ productId: string | null; isTaxable?: boolean }>): Promise<void> {
    const productIds = Array.from(
      new Set(snapshots.map((s) => s.productId).filter((id): id is string => !!id)),
    );
    if (productIds.length === 0) return;

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        hsnCode: true,
        gstRateBps: true,
        supplyTaxability: true,
        taxConfigVerified: true,
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const snap of snapshots) {
      if (!snap.productId) continue;
      const p = byId.get(snap.productId);
      if (!p) continue;

      // TAXABLE products must have a valid HSN.
      const taxability = p.supplyTaxability ?? 'TAXABLE';
      if (taxability === 'TAXABLE') {
        if (!p.hsnCode || !/^\d{4,8}$/.test(p.hsnCode)) {
          await this.taxMode.report({
            code: 'product.missing_hsn',
            message: `Product ${p.id} has no valid HSN — strict mode requires HSN on every taxable invoice line`,
            context: { productId: p.id, hsnCode: p.hsnCode },
          });
        }
        if (p.gstRateBps === null || p.gstRateBps === undefined || p.gstRateBps <= 0) {
          await this.taxMode.report({
            code: 'product.missing_rate',
            message: `Product ${p.id} has no GST rate — strict mode requires a non-zero rate on every taxable invoice line`,
            context: { productId: p.id, gstRateBps: p.gstRateBps },
          });
        }
      }

      // All products (taxable + exempt) must have an admin attestation
      // on file. Closes audit Gap #1 + #15 — the verified flag now
      // gates invoice content, not just the readiness dashboard.
      if (!p.taxConfigVerified) {
        await this.taxMode.report({
          code: 'product.unverified_config',
          message: `Product ${p.id} tax config has not been attested by an admin — strict mode requires admin sign-off before invoicing`,
          context: { productId: p.id },
        });
      }
    }
  }

  /**
   * Generate (or return existing) tax document for one SubOrder.
   * Idempotent unless `options.forceNew` is true.
   */
  async generateForSubOrder(
    subOrderId: string,
    options: GenerateForSubOrderOptions = {},
  ): Promise<GenerateResult> {
    // 1. Idempotency check.
    if (!options.forceNew) {
      const existing = await this.prisma.taxDocument.findFirst({
        where: {
          subOrderId,
          status: {
            notIn: ['VOIDED_DRAFT', 'SUPERSEDED', 'FULLY_REVERSED'],
          },
          documentType: {
            in: ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE_CUM_BILL_OF_SUPPLY'],
          },
        },
        select: { id: true, documentNumber: true, documentType: true },
        orderBy: { generatedAt: 'desc' },
      });
      if (existing) {
        return {
          document: existing,
          isNew: false,
          reason: 'A non-cancelled document already exists for this sub-order.',
        };
      }
    }

    // 2. Load SubOrderTaxSummary + lines.
    const summary = await this.prisma.subOrderTaxSummary.findUnique({
      where: { subOrderId },
    });
    if (!summary) {
      throw new Error(
        `Cannot generate document: no SubOrderTaxSummary for sub-order ${subOrderId}. ` +
        `Run TaxSnapshotService.createSnapshotsForMasterOrder first.`,
      );
    }

    const snapshots = await this.prisma.orderItemTaxSnapshot.findMany({
      where: { subOrderId },
      orderBy: [{ lineType: 'asc' }, { createdAt: 'asc' }],
    });
    if (snapshots.length === 0) {
      throw new Error(`No tax-line snapshots for sub-order ${subOrderId}`);
    }

    // Phase 45 (2026-05-21) — TaxModeService gate. Runs before we
    // allocate a document number so a STRICT failure doesn't burn a
    // sequence slot or leave a half-written row. AUDIT mode logs and
    // proceeds; OFF is silent.
    await this.assertInvoiceLinesAreTaxReady(snapshots);

    // 3. Load sub-order + master + seller + customer context.
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        sellerId: true,
        franchiseId: true,
        fulfillmentNodeType: true,
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            paymentMethod: true,
            shippingAddressSnapshot: true,
            // Phase 37 — the B2B profile the buyer picked at checkout.
            selectedTaxProfileId: true,
          },
        },
      },
    });
    if (!subOrder) throw new Error(`SubOrder ${subOrderId} not found`);

    // Supplier identity.
    let supplierGstin: string | null = null;
    let sellerLegalName: string | null = null;
    let sellerAddressJson: unknown = null;
    let sellerStateCode: string | null = null;
    let sellerRegistrationType: GstRegistrationType | null = null;
    // Phase 161 (Platform GST Profile audit B3) — snapshot FK to the minting
    // platform profile (OWN_BRAND / SPORTSMART supplies only).
    let platformGstProfileId: string | null = null;

    if (summary.supplierType === 'MARKETPLACE_SELLER' && subOrder.sellerId) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: subOrder.sellerId },
        select: {
          gstin: true,
          legalBusinessName: true,
          registeredBusinessAddressJson: true,
          gstStateCode: true,
          gstRegistrationType: true,
          sellerName: true,
          sellerShopName: true,
        },
      });
      if (seller) {
        supplierGstin = seller.gstin;
        sellerLegalName = seller.legalBusinessName ?? seller.sellerShopName ?? seller.sellerName;
        sellerAddressJson = seller.registeredBusinessAddressJson;
        sellerStateCode = seller.gstStateCode;
        sellerRegistrationType = seller.gstRegistrationType;
        // Phase 161 (Seller GSTIN Verification audit #6) — STRICT mode must
        // not invoice under an unverified / name-mismatched seller GSTIN.
        // report() is non-blocking outside STRICT (logs in AUDIT, no-op in
        // OFF), so this is safe for the current default mode.
        if (seller.gstin) {
          const gstinRow = await this.prisma.sellerGstin.findFirst({
            where: { sellerId: subOrder.sellerId, gstin: seller.gstin },
            select: { isVerified: true, legalNameMismatch: true },
          });
          if (!gstinRow || !gstinRow.isVerified) {
            await this.taxMode.report({
              code: 'seller.gstin.unverified',
              message: `Seller ${subOrder.sellerId} GSTIN ${seller.gstin} is not GSTN-verified — strict mode requires a verified seller GSTIN before invoicing`,
              context: { sellerId: subOrder.sellerId, gstin: seller.gstin },
            });
          } else if (gstinRow.legalNameMismatch) {
            await this.taxMode.report({
              code: 'seller.gstin.legal_name_mismatch',
              message: `Seller ${subOrder.sellerId} GSTIN ${seller.gstin} legal name differs from the GST portal — strict mode requires resolution before invoicing`,
              context: { sellerId: subOrder.sellerId, gstin: seller.gstin },
            });
          }
        }
      }
    } else if (summary.supplierType === 'FRANCHISE' && subOrder.franchiseId) {
      // Franchise has gstNumber / panNumber but not the full new
      // supplier model yet. Read what's available.
      // Prisma model is `FranchisePartner`; `prisma.franchise` does not
      // exist (would runtime-crash any FRANCHISE supplier invoice).
      const franchise = await this.prisma.franchisePartner.findUnique({
        where: { id: subOrder.franchiseId },
        select: {
          gstNumber: true,
          panNumber: true,
          state: true,
          // Franchises don't yet have legalBusinessName field; use franchise name.
          franchiseCode: true,
          ownerName: true,
          businessName: true,
        },
      });
      if (franchise) {
        supplierGstin = franchise.gstNumber;
        sellerLegalName = franchise.businessName ?? franchise.ownerName ?? franchise.franchiseCode;
        sellerStateCode = franchise.state;
        sellerRegistrationType = 'REGULAR';
      }
    } else {
      // OWN_BRAND / SPORTSMART → load platform GST profile.
      const platform = await this.prisma.platformGstProfile.findFirst({
        where: { isDefault: true, isActive: true },
      });
      if (platform) {
        supplierGstin = platform.gstin;
        sellerLegalName = platform.legalBusinessName;
        sellerAddressJson = platform.registeredAddressJson;
        sellerStateCode = platform.gstStateCode;
        sellerRegistrationType = platform.registrationType;
        // Phase 161 (audit B3) — record WHICH profile minted this invoice so
        // reports can group by profile without a GSTIN-string scan. (The
        // supplier identity itself is already snapshotted in the seller*
        // columns, so there's no historical drift; this is the FK only.)
        platformGstProfileId = platform.id;
      }
    }

    // Recipient identity (customer).
    // Phase 37 — checkout may have picked a non-default profile. The
    // selectedTaxProfileId snapshot wins when present; otherwise we
    // fall back to whatever profile is currently isDefault.
    const selectedProfileId = (subOrder.masterOrder as any).selectedTaxProfileId as
      | string
      | null
      | undefined;
    // Phase 200 (audit #11) — place-order snapshot of the chosen profile,
    // captured on MasterOrder.customer_tax_profile_snapshot (added by migration
    // 20260602380000). Shape: { gstin, legalName, billingAddress, stateCode }.
    // Read only when a B2B profile was selected AND the live row resolution
    // below misses; the raw read avoids a hard dependency on the generated
    // Prisma type before the cross-module orders.prisma field lands.
    const profileSnapshot = selectedProfileId
      ? await this.readProfileSnapshot(subOrder.masterOrder.id)
      : null;
    let customerProfile;
    let snapshotFallbackUsed = false;
    if (selectedProfileId) {
      customerProfile = await this.prisma.customerTaxProfile.findFirst({
        where: {
          id: selectedProfileId,
          customerId: subOrder.masterOrder.customerId,
        },
      });
      // Phase 161 (Customer Tax Profile audit #6) — fail LOUD when the order
      // references a tax profile the customer doesn't own, instead of silently
      // falling back to the default (which would silently downgrade a B2B
      // order to B2C and issue the wrong invoice type).
      //
      // Phase 200 (audit #11) — EXCEPT when the profile was DELETED after the
      // order was placed: the order legitimately chose a B2B GSTIN, so recover
      // the buyer identity from the place-order snapshot rather than failing
      // invoice generation permanently. Only the snapshot (which we KNOW was
      // this customer's at placement) is trusted — a missing selection with no
      // snapshot still throws (genuinely bad reference).
      if (!customerProfile) {
        if (profileSnapshot && profileSnapshot.gstin) {
          snapshotFallbackUsed = true;
          this.logger.warn(
            `SubOrder ${subOrderId}: selected tax profile ${selectedProfileId} no longer exists; ` +
              `recovering buyer identity from the place-order snapshot (GSTIN ${profileSnapshot.gstin}).`,
          );
        } else {
          throw new BadRequestAppException(
            `Selected tax profile ${selectedProfileId} not found or not owned by this customer.`,
          );
        }
      }
    } else {
      customerProfile = await this.prisma.customerTaxProfile.findFirst({
        where: { customerId: subOrder.masterOrder.customerId, isDefault: true },
      });
    }
    // Phase 161 (audit B2) — snapshot FK to the buyer profile (null for B2C, or
    // when the live row is gone and we fell back to the JSON snapshot).
    const customerTaxProfileId = customerProfile?.id ?? null;
    const customer = await this.prisma.user.findUnique({
      where: { id: subOrder.masterOrder.customerId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const buyerGstin =
      customerProfile?.gstin ?? (snapshotFallbackUsed ? profileSnapshot!.gstin : null);
    const invoiceType: InvoiceType = buyerGstin ? 'B2B' : 'B2C';
    const buyerLegalName =
      customerProfile?.legalName ??
      (snapshotFallbackUsed ? profileSnapshot!.legalName : null) ??
      (customer ? `${customer.firstName} ${customer.lastName}`.trim() : null);
    const billingAddressJson =
      customerProfile?.billingAddressJson ??
      (snapshotFallbackUsed ? profileSnapshot!.billingAddress : null) ??
      subOrder.masterOrder.shippingAddressSnapshot;

    // Phase 161 (Customer Tax Profile audit B3) — STRICT mode must not issue a
    // B2B invoice to an unverified / name-mismatched buyer GSTIN (it breaks the
    // buyer's GSTR-2A reconciliation + ITC claim). report() is non-blocking
    // outside STRICT (logs in AUDIT, no-op in OFF).
    if (buyerGstin && customerProfile) {
      if (!customerProfile.isVerified) {
        await this.taxMode.report({
          code: 'buyer.gstin.unverified',
          message: `B2B invoice buyer GSTIN ${buyerGstin} is not GSTN-verified — strict mode requires a verified buyer profile before invoicing`,
          context: { customerId: subOrder.masterOrder.customerId, gstin: buyerGstin },
        });
      } else if (customerProfile.legalNameMismatch) {
        await this.taxMode.report({
          code: 'buyer.gstin.name_mismatch',
          message: `B2B invoice buyer GSTIN ${buyerGstin} legal name differs from the GST portal — strict mode requires resolution before invoicing`,
          context: { customerId: subOrder.masterOrder.customerId, gstin: buyerGstin },
        });
      }
      // Phase 161 (audit #18) — record that this profile was used (best-effort).
      void this.prisma.customerTaxProfile
        .update({ where: { id: customerProfile.id }, data: { lastSelectedAt: new Date() } })
        .catch(() => undefined);
    }

    // 4. Decide document type.
    const hasTaxableLines = snapshots.some(
      (s) =>
        s.supplyTaxability === 'TAXABLE' || s.supplyTaxability === 'ZERO_RATED',
    );
    const hasExemptLines = snapshots.some(
      (s) =>
        s.supplyTaxability === 'NIL_RATED' ||
        s.supplyTaxability === 'EXEMPT' ||
        s.supplyTaxability === 'NON_GST' ||
        s.supplyTaxability === 'OUT_OF_SCOPE',
    );
    const typeDecision: DocumentTypePickerResult = pickDocumentType({
      sellerRegistrationType,
      hasTaxableLines,
      hasExemptLines,
    });
    const documentType = typeDecision.documentType;

    // 5. Allocate number.
    const fy = DocumentSequenceService.financialYearOf(new Date());
    const numberAlloc = await this.docSequence.nextNumber({
      supplierGstin,
      financialYear: fy,
      documentType,
    });

    // 6. Compute round-off + totals + amount-in-words.
    const rawTotalInPaise =
      summary.taxableAmountInPaise +
      summary.totalTaxAmountInPaise +
      summary.cessAmountInPaise;
    const roundOff = computeInvoiceRoundOff(rawTotalInPaise);
    const amountInWords = paiseToInvoiceWords(
      roundOff.roundedAmountInPaise < 0n ? -roundOff.roundedAmountInPaise : roundOff.roundedAmountInPaise,
    );

    // 7. Persist document + lines in one tx.
    const doc = await this.prisma.$transaction(async (tx) => {
      // If forceNew with an existing doc, mark the prior SUPERSEDED
      // — but only for statuses the state machine actually permits
      // (GENERATED / PDF_PENDING / PDF_GENERATED / PDF_FAILED /
      // PARTIALLY_REVERSED). Terminal statuses (FULLY_REVERSED,
      // SUPERSEDED, VOIDED_DRAFT) cannot be re-superseded.
      if (options.forceNew) {
        await tx.taxDocument.updateMany({
          where: {
            subOrderId,
            status: {
              in: [
                'GENERATED',
                'PDF_PENDING',
                'PDF_GENERATED',
                'PDF_FAILED',
                'PARTIALLY_REVERSED',
              ],
            },
            documentType: {
              in: ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE_CUM_BILL_OF_SUPPLY'],
            },
          },
          data: { status: 'SUPERSEDED' },
        });
      }

      const created = await tx.taxDocument.create({
        data: {
          documentNumber: numberAlloc.documentNumber,
          documentType,
          financialYear: fy,
          masterOrderId: subOrder.masterOrder.id,
          subOrderId: subOrder.id,
          sellerId: subOrder.sellerId,
          customerId: subOrder.masterOrder.customerId,
          supplierType: summary.supplierType ?? ('MARKETPLACE_SELLER' as SupplierType),
          invoiceType,
          // Phase 159w (audit B2) — stamp the GST mode this invoice was issued
          // under, so a later re-export / refund recompute can validate against
          // the mode in effect at issue time rather than the live mode.
          gstModeSnapshot: await this.taxMode.getMode(),

          supplierGstin,
          sellerRegistrationType,
          sellerLegalName,
          sellerAddressJson: sellerAddressJson as Prisma.InputJsonValue,
          sellerStateCode,
          // Phase 161 (audit B3) — snapshot FK to the minting platform profile.
          platformGstProfileId,

          buyerGstin,
          buyerLegalName,
          // Phase 161 (audit B2) — snapshot FK to the buyer tax profile.
          customerTaxProfileId,
          billingAddressJson: (billingAddressJson ?? null) as Prisma.InputJsonValue,
          shippingAddressJson: subOrder.masterOrder.shippingAddressSnapshot as Prisma.InputJsonValue,
          placeOfSupplyStateCode: summary.placeOfSupplyStateCode,

          reverseChargeApplicable: false, // RCM is off by default for B2C goods
          reverseChargeReason: null,

          taxableAmountInPaise: summary.taxableAmountInPaise,
          cgstAmountInPaise: summary.cgstAmountInPaise,
          sgstAmountInPaise: summary.sgstAmountInPaise,
          igstAmountInPaise: summary.igstAmountInPaise,
          totalTaxAmountInPaise: summary.totalTaxAmountInPaise,
          cessAmountInPaise: summary.cessAmountInPaise,
          roundOffAmountInPaise: roundOff.roundOffInPaise,
          documentTotalInPaise: roundOff.roundedAmountInPaise,
          amountInWords,
          currencyCode: 'INR',
          paymentMode: subOrder.masterOrder.paymentMethod ?? null,

          status: 'PDF_PENDING',
          einvoiceStatus: 'NOT_APPLICABLE',
          generatedAt: new Date(),
        },
      });

      // Lines — one per snapshot. lineNumber follows snapshot order.
      for (let i = 0; i < snapshots.length; i++) {
        const s = snapshots[i]!;

        await tx.taxDocumentLine.create({
          data: {
            documentId: created.id,
            sourceSnapshotId: s.id,
            lineNumber: i + 1,
            lineType: s.lineType,
            productId: s.productId,
            variantId: s.variantId,
            productName: s.description ?? 'Item',
            sku: null,
            hsnOrSacCode: s.hsnCode,
            uqcCode: s.uqcCode,
            quantity: s.quantity ?? new Prisma.Decimal(1),
            unitPriceInPaise:
              s.quantity && Number(s.quantity) > 0
                ? s.grossLineAmountInPaise / BigInt(Math.floor(Number(s.quantity)))
                : s.grossLineAmountInPaise,
            grossAmountInPaise: s.grossLineAmountInPaise,
            discountAmountInPaise: s.discountAmountInPaise,
            taxableAmountInPaise: s.taxableAmountInPaise,
            gstRateBps: s.gstRateBps,
            // Phase 159y (GSTR-3B audit #2) — carry the line's supply
            // classification onto the invoice line for the GSTR-3B §3.1(b/c/e)
            // split. POS lines (other create site) stay null = TAXABLE default.
            supplyTaxability: s.supplyTaxability,
            cgstAmountInPaise: s.cgstAmountInPaise,
            sgstAmountInPaise: s.sgstAmountInPaise,
            igstAmountInPaise: s.igstAmountInPaise,
            totalTaxAmountInPaise: s.totalTaxAmountInPaise,
            cessAmountInPaise: s.cessAmountInPaise,
            lineTotalInPaise: s.lineTotalAfterDiscountAndTaxInPaise,
            currencyCode: 'INR',
          },
        });
      }

      return created;
    });

    this.logger.log(
      `Generated ${documentType} ${doc.documentNumber} (FY ${fy}) for sub-order ${subOrderId}: ${typeDecision.reason}`,
    );

    // Fire EWB classification post-commit so the e-way bill queue picks
    // up the sub-order automatically. Best-effort: never block invoice
    // generation on a classification failure — admins can still manually
    // hit POST /admin/tax/eway-bills/sub-order/:id/generate, which classifies
    // internally on its own.
    try {
      await this.ewayBill.classifyForSubOrder(subOrderId);
    } catch (err) {
      this.logger.warn(
        `EWB classification failed for sub-order ${subOrderId} after invoice ${doc.documentNumber}: ${(err as Error).message}`,
      );
    }

    // Phase 90 (2026-05-23) — Gap #1. Auto e-invoice classification.
    // Pre-Phase-90 every TaxDocument was inserted with
    // einvoiceStatus=NOT_APPLICABLE; the retry cron filter
    // (PENDING/FAILED) never picked them up, so B2B documents
    // required a manual admin click to ever flip to PENDING. Fire
    // the hook here in best-effort mode so the typed-path cron + UI
    // picks up applicable rows automatically.
    if (this.einvoice) {
      try {
        await this.einvoice.classifyForDocument(doc.id);
      } catch (err) {
        this.logger.warn(
          `E-invoice classification failed for ${doc.documentNumber}: ${(err as Error).message}`,
        );
      }
    }

    return {
      document: { id: doc.id, documentNumber: doc.documentNumber, documentType: doc.documentType },
      isNew: true,
      reason: typeDecision.reason,
    };
  }

  /**
   * Follow-up #133 — generate (or return existing) tax invoice for a
   * franchise POS sale. Mirrors generateForSubOrder but reads from
   * FranchisePosSale + FranchisePosSaleItem (Decimal money fields)
   * instead of SubOrderTaxSummary + OrderItemTaxSnapshot (BigInt
   * paise). Walk-in B2C is the default; customerGstin capture at the
   * register is a future enhancement.
   *
   * Idempotent: a non-cancelled document already linked to this saleId
   * short-circuits and returns the existing row.
   */
  async generateForPosSale(
    saleId: string,
    options: GenerateForSubOrderOptions = {},
  ): Promise<GenerateResult> {
    // 1. Idempotency check on posSaleId.
    if (!options.forceNew) {
      const existing = await this.prisma.taxDocument.findFirst({
        where: {
          posSaleId: saleId,
          status: {
            notIn: ['VOIDED_DRAFT', 'SUPERSEDED', 'FULLY_REVERSED'],
          },
        },
        select: { id: true, documentNumber: true, documentType: true },
        orderBy: { generatedAt: 'desc' },
      });
      if (existing) {
        return {
          document: existing,
          isNew: false,
          reason: 'A non-cancelled document already exists for this POS sale.',
        };
      }
    }

    // 2. Load sale + items.
    const sale = await this.prisma.franchisePosSale.findUnique({
      where: { id: saleId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!sale) throw new Error(`FranchisePosSale ${saleId} not found`);
    if (sale.items.length === 0) {
      throw new Error(`POS sale ${saleId} has no items — refusing to issue invoice`);
    }
    if (sale.status !== 'COMPLETED') {
      throw new Error(
        `Cannot issue invoice for POS sale ${saleId}: status=${sale.status}`,
      );
    }

    // 3. Load franchise (supplier identity).
    const franchise = await this.prisma.franchisePartner.findUnique({
      where: { id: sale.franchiseId },
      select: {
        id: true,
        gstNumber: true,
        state: true,
        franchiseCode: true,
        ownerName: true,
        businessName: true,
      },
    });
    if (!franchise) {
      throw new Error(`Franchise ${sale.franchiseId} not found for POS sale ${saleId}`);
    }

    const supplierGstin = franchise.gstNumber;
    const sellerLegalName =
      franchise.businessName ?? franchise.ownerName ?? franchise.franchiseCode;
    const sellerStateCode = franchise.state ?? sale.placeOfSupplyState ?? null;

    // 4. Compute totals in BigInt paise. POS persists Decimal(10,2) in
    //    INR; multiply by 100 + round to integer paise.
    const toPaise = (d: Prisma.Decimal | number | null | undefined): bigint => {
      if (d === null || d === undefined) return 0n;
      const num = typeof d === 'number' ? d : Number(d);
      return BigInt(Math.round(num * 100));
    };

    let taxableAmountInPaise = 0n;
    let cgstAmountInPaise = 0n;
    let sgstAmountInPaise = 0n;
    let igstAmountInPaise = 0n;
    for (const item of sale.items) {
      taxableAmountInPaise += toPaise(item.taxableAmount);
      cgstAmountInPaise += toPaise(item.cgstAmount);
      sgstAmountInPaise += toPaise(item.sgstAmount);
      igstAmountInPaise += toPaise(item.igstAmount);
    }
    const totalTaxAmountInPaise =
      cgstAmountInPaise + sgstAmountInPaise + igstAmountInPaise;

    // 5. Pick document type — franchise is REGULAR registration, all
    //    POS items are TAXABLE (POS doesn't sell exempt goods today),
    //    so this resolves to TAX_INVOICE. Codify via the picker so any
    //    future exempt-line handling lands here automatically.
    const hasTaxableLines = sale.items.some((i) => Number(i.taxableAmount) > 0);
    const typeDecision: DocumentTypePickerResult = pickDocumentType({
      sellerRegistrationType: 'REGULAR' as GstRegistrationType,
      hasTaxableLines,
      hasExemptLines: false,
    });
    const documentType = typeDecision.documentType;

    // 6. Allocate document number under the franchise's GSTIN sequence.
    const fy = DocumentSequenceService.financialYearOf(new Date());
    const numberAlloc = await this.docSequence.nextNumber({
      supplierGstin,
      financialYear: fy,
      documentType,
    });

    // 7. Round-off + amount-in-words.
    const rawTotalInPaise = taxableAmountInPaise + totalTaxAmountInPaise;
    const roundOff = computeInvoiceRoundOff(rawTotalInPaise);
    const amountInWords = paiseToInvoiceWords(
      roundOff.roundedAmountInPaise < 0n
        ? -roundOff.roundedAmountInPaise
        : roundOff.roundedAmountInPaise,
    );

    // 8. Persist document + lines in one tx.
    const doc = await this.prisma.$transaction(async (tx) => {
      if (options.forceNew) {
        await tx.taxDocument.updateMany({
          where: {
            posSaleId: saleId,
            status: {
              in: [
                'GENERATED',
                'PDF_PENDING',
                'PDF_GENERATED',
                'PDF_FAILED',
                'PARTIALLY_REVERSED',
              ],
            },
          },
          data: { status: 'SUPERSEDED' },
        });
      }

      const created = await tx.taxDocument.create({
        data: {
          documentNumber: numberAlloc.documentNumber,
          documentType,
          financialYear: fy,
          // POS rows leave master/sub null and use posSaleId.
          posSaleId: sale.id,
          customerId: null,
          supplierType: 'FRANCHISE' as SupplierType,
          // Walk-in B2C is the default; B2B GSTIN capture at register
          // is a future enhancement (sale.customerGstin column).
          invoiceType: 'B2C' as InvoiceType,
          // Phase 159w (audit B2) — GST mode at issue time (see above).
          gstModeSnapshot: await this.taxMode.getMode(),

          supplierGstin,
          sellerRegistrationType: 'REGULAR' as GstRegistrationType,
          sellerLegalName,
          sellerAddressJson: Prisma.JsonNull,
          sellerStateCode,

          buyerGstin: null,
          buyerLegalName: sale.customerName ?? 'Walk-in customer',
          billingAddressJson: Prisma.JsonNull,
          shippingAddressJson: Prisma.JsonNull,
          placeOfSupplyStateCode: sale.placeOfSupplyState ?? sellerStateCode,

          reverseChargeApplicable: false,
          reverseChargeReason: null,

          taxableAmountInPaise,
          cgstAmountInPaise,
          sgstAmountInPaise,
          igstAmountInPaise,
          totalTaxAmountInPaise,
          cessAmountInPaise: 0n,
          roundOffAmountInPaise: roundOff.roundOffInPaise,
          documentTotalInPaise: roundOff.roundedAmountInPaise,
          amountInWords,
          currencyCode: 'INR',
          paymentMode: sale.paymentMethod,

          status: 'PDF_PENDING',
          einvoiceStatus: 'NOT_APPLICABLE',
          generatedAt: new Date(),
        },
      });

      for (let i = 0; i < sale.items.length; i++) {
        const item = sale.items[i]!;
        const lineTaxablePaise = toPaise(item.taxableAmount);
        const lineCgstPaise = toPaise(item.cgstAmount);
        const lineSgstPaise = toPaise(item.sgstAmount);
        const lineIgstPaise = toPaise(item.igstAmount);
        const lineTaxPaise = lineCgstPaise + lineSgstPaise + lineIgstPaise;
        const lineGrossPaise = toPaise(item.lineTotal);
        const lineDiscountPaise = toPaise(item.lineDiscount);
        const unitPricePaise = toPaise(item.unitPrice);

        await tx.taxDocumentLine.create({
          data: {
            documentId: created.id,
            sourceSnapshotId: null,
            lineNumber: i + 1,
            lineType: 'PRODUCT',
            productId: item.productId,
            variantId: item.variantId,
            productName: item.variantTitle
              ? `${item.productTitle} — ${item.variantTitle}`
              : item.productTitle,
            sku: item.franchiseSku ?? item.globalSku,
            hsnOrSacCode: item.hsnCode,
            uqcCode: null,
            quantity: new Prisma.Decimal(item.quantity),
            unitPriceInPaise: unitPricePaise,
            grossAmountInPaise: lineGrossPaise,
            discountAmountInPaise: lineDiscountPaise,
            taxableAmountInPaise: lineTaxablePaise,
            gstRateBps: item.gstRateBps,
            cgstAmountInPaise: lineCgstPaise,
            sgstAmountInPaise: lineSgstPaise,
            igstAmountInPaise: lineIgstPaise,
            totalTaxAmountInPaise: lineTaxPaise,
            cessAmountInPaise: 0n,
            lineTotalInPaise: lineTaxablePaise + lineTaxPaise,
            currencyCode: 'INR',
          },
        });
      }

      return created;
    });

    this.logger.log(
      `Generated POS ${documentType} ${doc.documentNumber} (FY ${fy}) for sale ${sale.saleNumber}: ${typeDecision.reason}`,
    );

    // Phase 90 (2026-05-23) — Gap #1. POS-sale invoices follow the
    // same auto-classify flow as sub-order invoices. POS sales are
    // mostly B2C (walk-in) and will fall to NOT_APPLICABLE via the
    // buyerGstin gate — but the hook stays so a B2B POS sale (legacy
    // bulk purchase) auto-classifies the same way.
    if (this.einvoice) {
      try {
        await this.einvoice.classifyForDocument(doc.id);
      } catch (err) {
        this.logger.warn(
          `E-invoice classification failed for POS ${doc.documentNumber}: ${(err as Error).message}`,
        );
      }
    }

    return {
      document: {
        id: doc.id,
        documentNumber: doc.documentNumber,
        documentType: doc.documentType,
      },
      isNew: true,
      reason: typeDecision.reason,
    };
  }

  /**
   * Phase 10 — generic status transition gated by the FSM.
   * Refuses forbidden transitions (e.g. GENERATED → VOIDED_DRAFT,
   * any → DRAFT, anything from a terminal state).
   *
   * For Section 34 reductions, use the credit-note path (Phase 11)
   * which transitions the source document to PARTIALLY_REVERSED or
   * FULLY_REVERSED through this method.
   */
  async transitionStatus(input: {
    documentId: string;
    toStatus: TaxDocumentStatus;
    reason?: string;
    actorId?: string | null;
  }): Promise<void> {
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: input.documentId },
      select: { id: true, status: true, documentNumber: true, documentType: true },
    });
    if (!doc) throw new Error(`TaxDocument ${input.documentId} not found`);

    assertTransitionAllowed(doc.status, input.toStatus);

    if (doc.status === input.toStatus) {
      // Idempotent self-transition
      return;
    }

    await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        status: input.toStatus,
        cancelledAt: input.toStatus === 'VOIDED_DRAFT' ? new Date() : undefined,
        reason: input.reason ?? undefined,
      },
    });
    this.logger.log(
      `TaxDocument ${doc.documentNumber} (${doc.documentType}) ${doc.status} → ${input.toStatus}` +
        (input.reason ? `: ${input.reason}` : '') +
        (input.actorId ? ` by ${input.actorId}` : ''),
    );
  }

  /**
   * Phase 10 — emergency void for a DRAFT document that was never
   * legally issued.
   *
   * Indian GST law forbids voiding an issued tax document; reductions
   * happen via CREDIT_NOTE. This path exists only for the rare case
   * where engineering / admin produced a DRAFT row (no shipment, no
   * customer-facing copy) that needs throwing away.
   *
   * Behaviour:
   *   - Refuses to void anything past DRAFT (FSM enforces).
   *   - If the document already had a number allocated, calls
   *     `DocumentSequenceService.markSkipped` so the burnt number
   *     appears in the audit JSON. (Current generation path doesn't
   *     produce DRAFT-with-number rows, but future preview flows
   *     might.)
   *
   * Requires `tax.override` permission on the calling admin path.
   */
  async voidDraft(input: {
    documentId: string;
    reason: string;
    actorId: string;
  }): Promise<void> {
    if (!input.reason || input.reason.trim().length < 3) {
      throw new Error('voidDraft requires a non-trivial reason (≥3 chars) for the audit trail');
    }

    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: input.documentId },
      select: {
        id: true,
        status: true,
        documentNumber: true,
        documentType: true,
        supplierGstin: true,
        financialYear: true,
      },
    });
    if (!doc) throw new Error(`TaxDocument ${input.documentId} not found`);

    if (isIssuedStatus(doc.status)) {
      throw new Error(
        `Cannot void issued document ${doc.documentNumber} (status=${doc.status}). ` +
          `Issue a CREDIT_NOTE for the full value via Phase 11 service instead.`,
      );
    }

    // FSM gate.
    assertTransitionAllowed(doc.status, 'VOIDED_DRAFT');

    await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        status: 'VOIDED_DRAFT',
        cancelledAt: new Date(),
        reason: input.reason,
      },
    });

    // Burn the number in the sequence audit. The current generation
    // path always allocates a number before the row reaches DB, so
    // every voided draft has a number to record.
    if (doc.documentNumber && doc.documentNumber.includes('-')) {
      const lastNumberStr = doc.documentNumber.split('-').pop()!;
      const lastNumber = parseInt(lastNumberStr, 10);
      if (Number.isFinite(lastNumber)) {
        const sequenceKey = DocumentSequenceService.sequenceKeyOf(
          doc.supplierGstin,
          doc.financialYear,
          doc.documentType,
        );
        await this.docSequence.markSkipped(
          sequenceKey,
          lastNumber,
          `VOIDED_DRAFT by ${input.actorId}: ${input.reason}`,
        );
      }
    }

    this.logger.warn(
      `Voided draft ${doc.documentNumber} (${doc.documentType}) by ${input.actorId}: ${input.reason}`,
    );
  }

  /**
   * Phase 200 (audit #11) — read MasterOrder.customer_tax_profile_snapshot via
   * raw SQL so this module compiles before the cross-module orders.prisma field
   * lands. Returns the parsed snapshot, or null when the column/value is absent
   * (pre-existing orders, or the central wiring not yet applied → falls through
   * to the existing live-lookup behaviour). Never throws.
   */
  private async readProfileSnapshot(masterOrderId: string): Promise<{
    gstin: string;
    legalName: string | null;
    billingAddress: unknown;
    stateCode: string | null;
  } | null> {
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ customer_tax_profile_snapshot: unknown }>
      >(Prisma.sql`
        SELECT "customer_tax_profile_snapshot"
        FROM "master_orders"
        WHERE "id" = ${masterOrderId}
        LIMIT 1
      `);
      return parseProfileSnapshot(rows[0]?.customer_tax_profile_snapshot);
    } catch (err) {
      // Column may not exist yet (migration not applied) — degrade gracefully.
      this.logger.warn(
        `readProfileSnapshot failed for master order ${masterOrderId}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}

/**
 * Phase 200 (Customer Tax Profile audit #11) — parse the buyer-profile snapshot
 * captured on MasterOrder.customerTaxProfileSnapshot at order placement. Used as
 * the fallback when the selected profile row has been deleted before the invoice
 * is generated. Returns null unless a usable {gstin} is present.
 */
function parseProfileSnapshot(raw: unknown): {
  gstin: string;
  legalName: string | null;
  billingAddress: unknown;
  stateCode: string | null;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const gstin = typeof s.gstin === 'string' ? s.gstin : null;
  if (!gstin) return null;
  return {
    gstin,
    legalName: typeof s.legalName === 'string' ? s.legalName : null,
    billingAddress: s.billingAddress ?? null,
    stateCode: typeof s.stateCode === 'string' ? s.stateCode : null,
  };
}
