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
import {
  AdminAuthGuard,
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
import { TcsService } from './application/services/tcs.service';
import { Gstr8ReportService } from './application/services/gstr8-report.service';
import { Gstr1ReportService } from './application/services/gstr1-report.service';
import { Gstr3bReportService } from './application/services/gstr3b-report.service';
import { SettlementTcsHookService } from './application/services/settlement-tcs-hook.service';
import { TaxDocumentPdfService } from './application/services/tax-document-pdf.service';
import { TaxDocumentDownloadService } from './application/services/tax-document-download.service';
import { TaxDocumentRetentionService } from './application/services/tax-document-retention.service';
import { EInvoiceService } from './application/services/einvoice.service';
import { TaxModeService } from './application/services/tax-mode.service';
import { TaxAuditReadinessService } from './application/services/tax-audit-readiness.service';
import { TaxNotificationService } from './application/services/tax-notification.service';
import { TaxCompatibilityService } from './application/services/tax-compatibility.service';
import { CustomerTaxDocumentsController } from './presentation/controllers/customer-tax-documents.controller';
import { SellerTaxDocumentsController } from './presentation/controllers/seller-tax-documents.controller';
import { AdminTaxReportsController } from './presentation/controllers/admin-tax-reports.controller';
import { TaxCreditNoteTimeBarCron } from './application/jobs/tax-credit-note-timebar.cron';
import { TaxDocumentPdfRetryCron } from './application/jobs/tax-document-pdf-retry.cron';
import { EInvoiceRetryCron } from './application/jobs/einvoice-retry.cron';
import {
  EINVOICE_PROVIDER,
  type EInvoiceProvider,
} from './infrastructure/einvoice/einvoice-provider';
import { StubEInvoiceProvider } from './infrastructure/einvoice/stub-einvoice-provider';
import {
  TAX_PDF_STORAGE_PROVIDER,
  type TaxPdfStorageProvider,
} from './infrastructure/pdf/tax-pdf-storage.provider';
import { StubTaxPdfStorageProvider } from './infrastructure/pdf/stub-tax-pdf-storage.provider';
import {
  EWAY_BILL_PROVIDER,
  type EWayBillProvider,
} from './infrastructure/eway-bill/eway-bill-provider';
import { StubEWayBillProvider } from './infrastructure/eway-bill/stub-eway-bill-provider';
import { EnvService } from '../../bootstrap/env/env.service';

// Phase 15 — Provider selector. Stub-only for now; the NIC adapter
// lands in a later phase tied to the e-invoicing decision (CA confirms
// timing). Switching is by env (EWAY_BILL_PROVIDER), not code.
const ewayBillProvider = {
  provide: EWAY_BILL_PROVIDER,
  useFactory: (env: EnvService): EWayBillProvider => {
    const choice = env.getString('EWAY_BILL_PROVIDER' as any, 'stub');
    switch (choice) {
      case 'stub':
        return new StubEWayBillProvider();
      case 'nic':
        // Real adapter is intentionally not wired yet — refuse loudly
        // so a deployment that flips the flag without finishing the
        // NIC integration crashes at boot instead of silently calling
        // the stub in production.
        throw new Error(
          "EWAY_BILL_PROVIDER='nic' selected but NicEWayBillProvider is " +
            'not yet implemented. Set EWAY_BILL_PROVIDER=stub or wire NIC.',
        );
      default:
        throw new Error(`Unknown EWAY_BILL_PROVIDER='${choice}'`);
    }
  },
  inject: [EnvService],
};

// Phase 22 — E-invoice provider selector. Same crash-loudly pattern:
// 'nic' refuses at boot until the real NIC IRP adapter is wired.
const einvoiceProvider = {
  provide: EINVOICE_PROVIDER,
  useFactory: (env: EnvService): EInvoiceProvider => {
    const choice = env.getString('EINVOICE_PROVIDER' as any, 'stub');
    switch (choice) {
      case 'stub':
        return new StubEInvoiceProvider();
      case 'nic':
        throw new Error(
          "EINVOICE_PROVIDER='nic' selected but NicEInvoiceProvider is " +
            'not yet implemented. Set EINVOICE_PROVIDER=stub or wire NIC IRP.',
        );
      default:
        throw new Error(`Unknown EINVOICE_PROVIDER='${choice}'`);
    }
  },
  inject: [EnvService],
};

// Phase 19 — Tax-document PDF storage provider selector. Same
// crash-loudly pattern as the EWB provider: 's3' is reserved until
// the S3 adapter supports PUT, then this factory will switch on it.
const taxPdfStorageProvider = {
  provide: TAX_PDF_STORAGE_PROVIDER,
  useFactory: (env: EnvService): TaxPdfStorageProvider => {
    const choice = env.getString('TAX_PDF_STORAGE_PROVIDER' as any, 'stub');
    switch (choice) {
      case 'stub':
        return new StubTaxPdfStorageProvider();
      case 's3':
        throw new Error(
          "TAX_PDF_STORAGE_PROVIDER='s3' selected but S3 adapter does not " +
            'yet support PUT. Set TAX_PDF_STORAGE_PROVIDER=stub or wire S3.',
        );
      default:
        throw new Error(`Unknown TAX_PDF_STORAGE_PROVIDER='${choice}'`);
    }
  },
  inject: [EnvService],
};

@Module({
  imports: [WalletModule, NotificationsModule],
  controllers: [
    CustomerTaxDocumentsController,
    SellerTaxDocumentsController,
    AdminTaxReportsController,
  ],
  providers: [
    // Phase 25 — guards consumed by the controllers above. Same
    // pattern as WalletModule / SettlementsModule.
    AdminAuthGuard,
    SellerAuthGuard,
    UserAuthGuard,
    PlaceOfSupplyService,
    TaxConfigService,
    TaxSnapshotService,
    DocumentSequenceService,
    TaxDocumentService,
    CreditNoteService,
    CreditNoteEligibilityService,
    WalletAdjustmentService,
    LegacyReceiptService,
    EWayBillService,
    ewayBillProvider,
    TcsService,
    Gstr8ReportService,
    Gstr1ReportService,
    Gstr3bReportService,
    SettlementTcsHookService,
    TaxDocumentPdfService,
    TaxDocumentDownloadService,
    TaxDocumentRetentionService,
    EInvoiceService,
    TaxModeService,
    TaxAuditReadinessService,
    TaxNotificationService,
    TaxCompatibilityService,
    taxPdfStorageProvider,
    einvoiceProvider,
    TaxCreditNoteTimeBarCron,
    TaxDocumentPdfRetryCron,
    EInvoiceRetryCron,
  ],
  exports: [
    PlaceOfSupplyService,
    TaxConfigService,
    TaxSnapshotService,
    DocumentSequenceService,
    TaxDocumentService,
    CreditNoteService,
    CreditNoteEligibilityService,
    WalletAdjustmentService,
    LegacyReceiptService,
    EWayBillService,
    TcsService,
    Gstr8ReportService,
    Gstr1ReportService,
    Gstr3bReportService,
    SettlementTcsHookService,
    TaxDocumentPdfService,
    TaxDocumentDownloadService,
    TaxDocumentRetentionService,
    EInvoiceService,
    TaxModeService,
    TaxAuditReadinessService,
    TaxNotificationService,
    TaxCompatibilityService,
  ],
})
export class TaxModule {}
