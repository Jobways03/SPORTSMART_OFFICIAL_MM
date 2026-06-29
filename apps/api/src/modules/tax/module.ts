// Phase 2 — TaxModule.
//
// Owns the tax-domain services (place-of-supply resolver, tax config,
// GSTIN validation utilities). Phase 3+ added the tax engine v2,
// document services, ledger writers, etc. Phase 12 added the Section 34
// credit-note time-bar cron + classification service. Phase 13 added
// the wallet-adjustment writer (goodwill + time-barred refunds).
//
// Other modules (discounts, orders, returns, settlements, shipping)
// import this to consume PlaceOfSupplyService / TaxConfigService.
//
// See docs/tax/CA.md §A for the phase log and §9 for the file map.

import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/module';
import { NotificationsModule } from '../notifications/module';
// Phase 36 — every GSTR-1 / GSTR-3B / GSTR-8 download is audited via
// AuditPublicFacade so bulk-PII exports leave a trail.
import { AuditModule } from '../audit/module';
// Phase 37 — read-side facade access for the marketplace commission
// GSTR-1 export (was reading SellerSettlement + Seller tables directly
// from inside the tax module).
import { SettlementsModule } from '../settlements/module';
// Phase 37 — read-side facade access for the cart-side tax preview
// (was reading cart + customer_addresses tables directly). Checkout
// already imports Tax, so we use a forwardRef to break the cycle.
import { CartModule } from '../cart/module';
import { CheckoutModule } from '../checkout/module';
// Phase 65 (2026-05-22) — server-side coupon resolution in the tax
// preview (audit Gap #1). forwardRef to break the implicit cycle
// since DiscountsModule already imports TaxModule via TaxPreviewService.
import { DiscountsModule } from '../discounts/discounts.module';
import { forwardRef } from '@nestjs/common';
import {
  AdminAuthGuard,
  PermissionsGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { PlaceOfSupplyService } from './application/services/place-of-supply.service';
import { TaxConfigService } from './application/services/tax-config.service';
import { TaxSnapshotService } from './application/services/tax-snapshot.service';
import { DocumentSequenceService } from './application/services/document-sequence.service';
import { TaxDocumentService } from './application/services/tax-document.service';
import { CreditNoteService } from './application/services/credit-note.service';
import { CreditNoteEligibilityService } from './application/services/credit-note-eligibility.service';
import { WalletAdjustmentService } from './application/services/wallet-adjustment.service';
import { LegacyReceiptService } from './application/services/legacy-receipt.service';
import { EWayBillService } from './application/services/eway-bill.service';
// Phase 89 (2026-05-23) — retry + expiry sweeps.
import { EWayBillRetryCron } from './application/jobs/eway-bill-retry.cron';
import { EWayBillExpiryCron } from './application/jobs/eway-bill-expiry.cron';
import { TcsService } from './application/services/tcs.service';
import { Gstr8ReportService } from './application/services/gstr8-report.service';
import { Gstr1ReportService } from './application/services/gstr1-report.service';
import { Gstr3bReportService } from './application/services/gstr3b-report.service';
import { SettlementTcsHookService } from './application/services/settlement-tcs-hook.service';
import { CommissionInvoiceService } from './application/services/commission-invoice.service';
import { Tds194OService } from './application/services/tds-194o.service';
import { SettlementTds194OHookService } from './application/services/settlement-tds-194o-hook.service';
import { Tds194OExemptionService } from './application/services/tds-194o-exemption.service';
import { Tds194ORevalidationCron } from './application/jobs/tds-194o-revalidation.cron';
import { Form26QReportService } from './application/services/form-26q-report.service';
import { MarketplaceCommissionGstrService } from './application/services/marketplace-commission-gstr.service';
import { CheckoutTaxPreviewService } from './application/services/checkout-tax-preview.service';
import { CartTaxPreviewService } from './application/services/cart-tax-preview.service';
import { TaxDocumentPdfService } from './application/services/tax-document-pdf.service';
import { HtmlToPdfService } from './infrastructure/pdf/html-to-pdf.service';
import { TaxDocumentDownloadService } from './application/services/tax-document-download.service';
import { TaxDocumentRetentionService } from './application/services/tax-document-retention.service';
import { EInvoiceService } from './application/services/einvoice.service';
import { TaxModeService } from './application/services/tax-mode.service';
import { TaxAuditReadinessService } from './application/services/tax-audit-readiness.service';
import { TaxNotificationService } from './application/services/tax-notification.service';
import { TaxCompatibilityService } from './application/services/tax-compatibility.service';
import { TaxPublicFacade } from './application/facades/tax-public.facade';
import { CustomerTaxProfileService } from './application/services/customer-tax-profile.service';
import { CustomerTaxDocumentsController } from './presentation/controllers/customer-tax-documents.controller';
import { CustomerTaxProfilesController } from './presentation/controllers/customer-tax-profiles.controller';
import { SellerTaxDocumentsController } from './presentation/controllers/seller-tax-documents.controller';
import { SellerTcsController } from './presentation/controllers/seller-tcs.controller';
import { FranchiseTaxDocumentsController } from './presentation/controllers/franchise-tax-documents.controller';
import { AdminTaxReportsController } from './presentation/controllers/admin-tax-reports.controller';
import { AdminTaxOperationsController } from './presentation/controllers/admin-tax-operations.controller';
import { TaxPdfFileController } from './presentation/controllers/tax-pdf-file.controller';
import { PublicTaxReferenceController } from './presentation/controllers/public-tax-reference.controller';
import { CustomerCartTaxPreviewController } from './presentation/controllers/customer-cart-tax-preview.controller';
import { AdminHsnMasterController } from './presentation/controllers/admin-hsn-master.controller';
import { HsnMasterService } from './application/services/hsn-master.service';
import { AdminUqcMasterController } from './presentation/controllers/admin-uqc-master.controller';
import { UqcMasterService } from './application/services/uqc-master.service';
import { AdminTaxConfigController } from './presentation/controllers/admin-tax-config.controller';
import { AdminPlatformGstProfileController } from './presentation/controllers/admin-platform-gst-profile.controller';
import { PlatformGstProfileService } from './application/services/platform-gst-profile.service';
import { TaxCreditNoteTimeBarCron } from './application/jobs/tax-credit-note-timebar.cron';
import { TaxDocumentPdfRetryCron } from './application/jobs/tax-document-pdf-retry.cron';
import { EInvoiceRetryCron } from './application/jobs/einvoice-retry.cron';
import { TaxReadinessSnapshotCron } from './application/jobs/tax-readiness-snapshot.cron';
import { GstnReVerificationCron } from './application/jobs/gstn-reverification.cron';
import {
  EINVOICE_PROVIDER,
  type EInvoiceProvider,
} from './infrastructure/einvoice/einvoice-provider';
import { StubEInvoiceProvider } from './infrastructure/einvoice/stub-einvoice-provider';
// Phase 90 (2026-05-23) — Gap #2 NIC IRP adapter.
import { NicEInvoiceProvider } from './infrastructure/einvoice/nic-einvoice-provider';
// MVP-launch defer — 'disabled' provider (boots in prod, mints nothing).
import { DisabledEInvoiceProvider } from './infrastructure/einvoice/disabled-einvoice-provider';
import {
  TAX_PDF_STORAGE_PROVIDER,
  type TaxPdfStorageProvider,
} from './infrastructure/pdf/tax-pdf-storage.provider';
import { StubTaxPdfStorageProvider } from './infrastructure/pdf/stub-tax-pdf-storage.provider';
import { R2TaxPdfStorageProvider } from './infrastructure/pdf/r2-tax-pdf-storage.provider';
import { R2Adapter } from '../../integrations/r2/adapters/r2.adapter';
import {
  EWAY_BILL_PROVIDER,
  type EWayBillProvider,
} from './infrastructure/eway-bill/eway-bill-provider';
import { StubEWayBillProvider } from './infrastructure/eway-bill/stub-eway-bill-provider';
// Phase 89 (2026-05-23) — Gap #1 NIC adapter.
import { NicEWayBillProvider } from './infrastructure/eway-bill/nic-eway-bill-provider';
// MVP-launch defer — 'disabled' provider (boots in prod, mints nothing).
import { DisabledEWayBillProvider } from './infrastructure/eway-bill/disabled-eway-bill-provider';
import {
  GSTN_PROVIDER,
  type GstnProvider,
} from './infrastructure/gstn/gstn-provider';
import { StubGstnProvider } from './infrastructure/gstn/stub-gstn-provider';
// MVP-launch defer — 'disabled' provider (boots in prod, claims nothing).
import { DisabledGstnProvider } from './infrastructure/gstn/disabled-gstn-provider';
import { GstnVerificationService } from './application/services/gstn-verification.service';
import { EnvService } from '../../bootstrap/env/env.service';

// Phase 89 (2026-05-23) — Gap #1 / #2. Provider selector with:
//   • Real NIC adapter (NicEWayBillProvider) for `nic`
//   • Stub-in-prod refusal: NODE_ENV=production + stub = crash at boot
//     so a misconfigured deploy never mints `EWB-STUB-{uuid}` fake
//     numbers under the CGST Rule 138 fraud blast radius.
const ewayBillProvider = {
  provide: EWAY_BILL_PROVIDER,
  useFactory: (env: EnvService): EWayBillProvider => {
    const choice = env.getString('EWAY_BILL_PROVIDER', 'stub');
    const nodeEnv = env.getString('NODE_ENV', 'development');
    if (choice === 'stub' && nodeEnv === 'production') {
      throw new Error(
        "EWAY_BILL_PROVIDER='stub' is unsafe in production — the stub mints " +
          "fake EWB-STUB-{uuid} numbers which under CGST Rule 138 + §122 is " +
          "GST fraud. Set EWAY_BILL_PROVIDER=nic with NIC_* credentials.",
      );
    }
    switch (choice) {
      case 'stub':
        return new StubEWayBillProvider();
      case 'nic':
        // Phase 89 — Gap #1 closure. Real adapter; refuses to
        // construct without all NIC_* env vars set.
        return new NicEWayBillProvider(env);
      case 'disabled':
        // MVP-launch defer — boots in prod, mints nothing. The service
        // reports the feature disabled so generation/canShip skip it.
        return new DisabledEWayBillProvider();
      default:
        throw new Error(`Unknown EWAY_BILL_PROVIDER='${choice}'`);
    }
  },
  inject: [EnvService],
};

// Phase 90 (2026-05-23) — Gap #2 / #3.
// Provider selector. Real NIC IRP adapter for 'nic'; stub-in-prod
// refusal: NODE_ENV=production + stub = crash at boot so the deploy
// never mints fake IRNs which under CGST §122 is GST fraud + buyer
// ITC denial.
const einvoiceProvider = {
  provide: EINVOICE_PROVIDER,
  useFactory: (env: EnvService): EInvoiceProvider => {
    const choice = env.getString('EINVOICE_PROVIDER', 'stub');
    const nodeEnv = env.getString('NODE_ENV', 'development');
    if (choice === 'stub' && nodeEnv === 'production') {
      throw new Error(
        "EINVOICE_PROVIDER='stub' is unsafe in production — the stub mints " +
          "SHA-256-derived IRNs that resemble NIC's format but are NOT " +
          "valid CBIC IRNs. Customer invoices would carry forged IRNs = " +
          "§122 penalty + buyer ITC denial. Set EINVOICE_PROVIDER=nic with " +
          "NIC_IRP_* credentials.",
      );
    }
    switch (choice) {
      case 'stub':
        return new StubEInvoiceProvider();
      case 'nic':
        return new NicEInvoiceProvider(env);
      case 'disabled':
        // MVP-launch defer — boots in prod, mints nothing. The service
        // reports the feature disabled so IRN generation is skipped.
        return new DisabledEInvoiceProvider();
      default:
        throw new Error(`Unknown EINVOICE_PROVIDER='${choice}'`);
    }
  },
  inject: [EnvService],
};

// Phase 35 — GSTN verification provider selector. `stub` derives the
// outcome from the local Mod-36 checksum; `sandbox` is reserved for
// the real GSTN sandbox API once credentials are issued. Same
// crash-loudly pattern as the other provider factories.
const gstnProvider = {
  provide: GSTN_PROVIDER,
  useFactory: (env: EnvService): GstnProvider => {
    const choice = env.getString('GSTN_PROVIDER', 'stub');
    switch (choice) {
      case 'stub':
        // Phase 161 (Seller GSTIN Verification audit #15) — the stub derives
        // "verified" purely from the local Mod-36 checksum; in production that
        // mints a FALSE compliance signal (a row looks GSTN-verified without
        // ever touching the portal). Refuse at boot, same as the e-invoice /
        // e-way-bill provider factories.
        if (env.getString('NODE_ENV', 'development') === 'production') {
          throw new Error(
            "GSTN_PROVIDER='stub' is unsafe in production — it marks GSTINs " +
              'verified from a local checksum without consulting the GST portal. ' +
              'Set GSTN_PROVIDER=sandbox with credentials before going live.',
          );
        }
        return new StubGstnProvider();
      case 'sandbox':
        throw new Error(
          "GSTN_PROVIDER='sandbox' selected but SandboxGstnProvider is " +
            'not yet implemented. Set GSTN_PROVIDER=stub or wire the GSTN sandbox.',
        );
      case 'disabled':
        // MVP-launch defer — boots in prod, claims nothing. verify() returns
        // found=false/UNKNOWN so GSTINs stay unverified for manual review,
        // never minting a false "verified" signal the way the stub would.
        return new DisabledGstnProvider();
      default:
        throw new Error(`Unknown GSTN_PROVIDER='${choice}'`);
    }
  },
  inject: [EnvService],
};

// Phase 19 / R2 migration — Tax-document PDF storage provider selector.
// 'r2' (Cloudflare R2, S3-compatible, PUT-capable) replaces the former
// reserved-and-throwing 's3' branch. 'stub' stays the dev/test default.
const taxPdfStorageProvider = {
  provide: TAX_PDF_STORAGE_PROVIDER,
  useFactory: (env: EnvService, r2: R2Adapter): TaxPdfStorageProvider => {
    const choice = env.getString('TAX_PDF_STORAGE_PROVIDER', 'stub');
    switch (choice) {
      case 'stub':
        return new StubTaxPdfStorageProvider();
      case 'r2':
        return new R2TaxPdfStorageProvider(r2);
      default:
        throw new Error(`Unknown TAX_PDF_STORAGE_PROVIDER='${choice}'`);
    }
  },
  inject: [EnvService, R2Adapter],
};

@Module({
  imports: [
    WalletModule,
    NotificationsModule,
    AuditModule,
    // SettlementsModule also imports TaxModule (for SettlementTcsHookService);
    // forwardRef on both sides resolves the circular dependency at bootstrap.
    forwardRef(() => SettlementsModule),
    // forwardRef: Cart participates in the Tax import cycle (cart tax preview),
    // like its Settlements/Checkout/Discounts siblings — defer or it resolves
    // to undefined at bootstrap.
    forwardRef(() => CartModule),
    forwardRef(() => CheckoutModule),
    // Phase 65 (2026-05-22) — DiscountsModule for server-side
    // coupon resolution in the tax preview (audit Gap #1).
    forwardRef(() => DiscountsModule),
  ],
  controllers: [
    CustomerTaxDocumentsController,
    CustomerTaxProfilesController,
    SellerTaxDocumentsController,
    SellerTcsController,
    FranchiseTaxDocumentsController,
    AdminTaxReportsController,
    AdminTaxOperationsController,
    // Dev-only: serves stub-stored invoice files over HTTP so the
    // download link isn't an unopenable file:// path.
    TaxPdfFileController,
    PublicTaxReferenceController,
    CustomerCartTaxPreviewController,
    AdminHsnMasterController,
    AdminUqcMasterController,
    AdminTaxConfigController,
    AdminPlatformGstProfileController,
  ],
  providers: [
    // Phase 25 — guards consumed by the controllers above. Same
    // pattern as WalletModule / SettlementsModule.
    AdminAuthGuard,
    PermissionsGuard,
    SellerAuthGuard,
    UserAuthGuard,
    PlaceOfSupplyService,
    TaxConfigService,
    TaxSnapshotService,
    DocumentSequenceService,
    TaxDocumentService,
    CreditNoteService,
    CreditNoteEligibilityService,
    CustomerTaxProfileService,
    WalletAdjustmentService,
    LegacyReceiptService,
    EWayBillService,
    ewayBillProvider,
    EWayBillRetryCron,
    EWayBillExpiryCron,
    TcsService,
    Gstr8ReportService,
    Gstr1ReportService,
    Gstr3bReportService,
    SettlementTcsHookService,
    Tds194OService,
    SettlementTds194OHookService,
    Form26QReportService,
    MarketplaceCommissionGstrService,
    CommissionInvoiceService,
    HsnMasterService,
    UqcMasterService,
    PlatformGstProfileService,
    CheckoutTaxPreviewService,
    CartTaxPreviewService,
    HtmlToPdfService,
    TaxDocumentPdfService,
    TaxDocumentDownloadService,
    TaxDocumentRetentionService,
    EInvoiceService,
    TaxModeService,
    TaxAuditReadinessService,
    TaxNotificationService,
    TaxCompatibilityService,
    TaxPublicFacade,
    taxPdfStorageProvider,
    einvoiceProvider,
    gstnProvider,
    GstnVerificationService,
    TaxCreditNoteTimeBarCron,
    TaxDocumentPdfRetryCron,
    EInvoiceRetryCron,
    // Phase 161 (TDS 194-O exempt audit) — exemption lifecycle + revalidation cron.
    Tds194OExemptionService,
    Tds194ORevalidationCron,
    // Phase 163 (Tax Audit Readiness audit #16) — 6-hourly readiness trend snapshot.
    TaxReadinessSnapshotCron,
    // Phase 200 (Customer Tax Profile audit #14) — weekly GSTN re-verification
    // (leader-elected, default-OFF until the live provider is wired).
    GstnReVerificationCron,
  ],
  exports: [
    // Exported so the shipping module (which imports TaxModule) can reuse the
    // same Puppeteer renderer for the HTML shipping label (single browser).
    HtmlToPdfService,
    PlaceOfSupplyService,
    TaxConfigService,
    TaxSnapshotService,
    DocumentSequenceService,
    TaxDocumentService,
    CreditNoteService,
    CreditNoteEligibilityService,
    CustomerTaxProfileService,
    WalletAdjustmentService,
    LegacyReceiptService,
    EWayBillService,
    TcsService,
    Gstr8ReportService,
    Gstr1ReportService,
    Gstr3bReportService,
    SettlementTcsHookService,
    Tds194OService,
    SettlementTds194OHookService,
    Form26QReportService,
    MarketplaceCommissionGstrService,
    CommissionInvoiceService,
    HsnMasterService,
    UqcMasterService,
    PlatformGstProfileService,
    CheckoutTaxPreviewService,
    CartTaxPreviewService,
    GstnVerificationService,
    TaxDocumentPdfService,
    TaxDocumentDownloadService,
    TaxDocumentRetentionService,
    EInvoiceService,
    TaxModeService,
    TaxAuditReadinessService,
    TaxNotificationService,
    TaxCompatibilityService,
    TaxPublicFacade,
  ],
})
export class TaxModule {}
