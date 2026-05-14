import 'reflect-metadata';
import {
  TAX_TEMPLATE_KEYS,
  TaxNotificationService,
} from '../../src/modules/tax/application/services/tax-notification.service';

// Phase 24 GST — TaxNotificationService tests.
//
// Verifies (a) the right template key is picked per event, (b) vars
// are JSON-safe + correctly formatted (paise → Indian rupees + IST
// dates), (c) eventClass routes correctly for preference checks, and
// (d) all methods are non-throwing on facade failure.

function makeService(): {
  service: TaxNotificationService;
  notifications: { notifyFromTemplate: jest.Mock };
} {
  const notifications = { notifyFromTemplate: jest.fn().mockResolvedValue('') };
  const service = new TaxNotificationService(notifications as any);
  return { service, notifications };
}

describe('TaxNotificationService — customer surface', () => {
  it('customerInvoiceIssued — picks the customer invoice template + tax.invoice eventClass', async () => {
    const { service, notifications } = makeService();
    await service.customerInvoiceIssued({
      customerId: 'u-1',
      documentId: 'doc-1',
      documentNumber: 'SM-INV-000001',
      documentTotalInPaise: 1_180_00n,
      documentDate: new Date(Date.UTC(2026, 3, 15, 10, 0, 0)),
      downloadUrl: 'https://x/d/123',
    });
    expect(notifications.notifyFromTemplate).toHaveBeenCalledWith({
      eventClass: 'tax.invoice',
      templateKey: TAX_TEMPLATE_KEYS.customer.invoiceIssued,
      recipientId: 'u-1',
      vars: {
        documentNumber: 'SM-INV-000001',
        documentTotalRupees: '1,180.00',
        documentDate: '15-04-2026',
        downloadUrl: 'https://x/d/123',
      },
      eventId: 'doc-1',
    });
  });

  it('customerCreditNoteIssued — captures return number + original invoice', async () => {
    const { service, notifications } = makeService();
    await service.customerCreditNoteIssued({
      customerId: 'u-1',
      documentId: 'cn-1',
      documentNumber: 'SM-CN-000007',
      documentTotalInPaise: 500_00n,
      originalInvoiceNumber: 'SM-INV-000001',
      returnNumber: 'RET-2026-000123',
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.customer.creditNoteIssued);
    expect(call.vars.originalInvoiceNumber).toBe('SM-INV-000001');
    expect(call.vars.returnNumber).toBe('RET-2026-000123');
    expect(call.vars.documentTotalRupees).toBe('500.00');
  });

  it('customerTimeBarredRefund — uses tax.refund event class with statutory reason', async () => {
    const { service, notifications } = makeService();
    await service.customerTimeBarredRefund({
      customerId: 'u-1',
      returnNumber: 'RET-2026-000200',
      refundAmountInPaise: 1_50_000_00n,
      walletAdjustmentId: 'adj-1',
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.eventClass).toBe('tax.refund');
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.customer.timeBarredRefund);
    expect(call.vars.refundAmountRupees).toBe('1,50,000.00');
    expect(call.vars.reason).toMatch(/Section 34/);
    expect(call.vars.reason).toMatch(/credited to your wallet/);
    expect(call.eventId).toBe('adj-1');
  });
});

describe('TaxNotificationService — seller surface', () => {
  it('sellerInvoiceIssued — recipient is the seller', async () => {
    const { service, notifications } = makeService();
    await service.sellerInvoiceIssued({
      sellerId: 'sel-1',
      documentId: 'doc-1',
      documentNumber: 'SM-INV-000001',
      documentTotalInPaise: 50_00n,
      documentDate: new Date(Date.UTC(2026, 3, 15)),
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.recipientId).toBe('sel-1');
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.seller.invoiceIssued);
  });

  it('sellerIrnGenerated — truncates IRN for the subject line', async () => {
    const { service, notifications } = makeService();
    await service.sellerIrnGenerated({
      sellerId: 'sel-1',
      documentId: 'doc-1',
      documentNumber: 'SM-INV-000001',
      irn: 'a'.repeat(8) + 'b'.repeat(52) + 'cccc', // 64 chars
      ackNo: 'STUB-9999',
      ackDate: new Date(Date.UTC(2026, 3, 15, 10, 0, 0)),
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.vars.irnPreview).toBe(`${'a'.repeat(8)}…cccc`);
    expect(call.vars.ackNo).toBe('STUB-9999');
    expect(call.vars.ackDate).toBe('15-04-2026');
  });

  it('sellerEwbGenerated — uses tax.ewb event class', async () => {
    const { service, notifications } = makeService();
    await service.sellerEwbGenerated({
      sellerId: 'sel-1',
      ewbId: 'ewb-1',
      ewbNumber: 'EWB-STUB-abc',
      documentNumber: 'SM-INV-000001',
      validUntil: new Date(Date.UTC(2026, 3, 17, 18, 29, 59)),
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.eventClass).toBe('tax.ewb');
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.seller.ewbGenerated);
    expect(call.vars.ewbNumber).toBe('EWB-STUB-abc');
    expect(call.vars.invoiceNumber).toBe('SM-INV-000001');
    expect(call.vars.validUntil).toBe('17-04-2026');
  });

  it('sellerEwbExpired — separate template from ewbGenerated', async () => {
    const { service, notifications } = makeService();
    await service.sellerEwbExpired({
      sellerId: 'sel-1',
      ewbId: 'ewb-1',
      ewbNumber: 'EWB-STUB-abc',
      documentNumber: null,
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.seller.ewbExpired);
    expect(call.vars.invoiceNumber).toBe('');
  });

  it('sellerSettlementTcsCollected — uses tax.settlement + Indian numbering', async () => {
    const { service, notifications } = makeService();
    await service.sellerSettlementTcsCollected({
      sellerId: 'sel-1',
      settlementId: 'st-1',
      filingPeriod: '2026-04',
      tcsDeductedInPaise: 1_00_000n, // ₹1,000
      netPayoutInPaise: 9_99_00_000n, // ₹9,99,000
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.eventClass).toBe('tax.settlement');
    expect(call.vars.filingPeriod).toBe('2026-04');
    expect(call.vars.tcsDeductedRupees).toBe('1,000.00');
    expect(call.vars.netPayoutRupees).toBe('9,99,000.00');
  });
});

describe('TaxNotificationService — admin surface', () => {
  it('adminGstr8FilingReminder — eventId scoped to filing period for idempotency', async () => {
    const { service, notifications } = makeService();
    await service.adminGstr8FilingReminder({
      adminId: 'adm-1',
      filingPeriod: '2026-04',
      daysUntilDue: 3,
      totalTcsInPaise: 25_000_00n,
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.eventClass).toBe('tax.compliance');
    expect(call.eventId).toBe('gstr8:2026-04');
    expect(call.vars.daysUntilDue).toBe(3);
    expect(call.vars.totalTcsRupees).toBe('25,000.00');
  });

  it('adminEinvoiceFailed — captures retry count + reason', async () => {
    const { service, notifications } = makeService();
    await service.adminEinvoiceFailed({
      adminId: 'adm-1',
      documentId: 'doc-1',
      documentNumber: 'SM-INV-000001',
      failureReason: 'NIC 503 Service Unavailable',
      retryCount: 5,
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.admin.einvoiceFailed);
    expect(call.vars.retryCount).toBe(5);
    expect(call.vars.failureReason).toBe('NIC 503 Service Unavailable');
  });

  it('adminTimeBarApproaching — captures cutoff window', async () => {
    const { service, notifications } = makeService();
    await service.adminTimeBarApproaching({
      adminId: 'adm-1',
      returnId: 'ret-1',
      returnNumber: 'RET-2026-000300',
      daysUntilCutoff: 5,
      sourceInvoiceNumber: 'SM-INV-000100',
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.admin.timeBarApproaching);
    expect(call.vars.daysUntilCutoff).toBe(5);
    expect(call.vars.sourceInvoiceNumber).toBe('SM-INV-000100');
  });

  it('adminPdfRenderFailed — fires per-document', async () => {
    const { service, notifications } = makeService();
    await service.adminPdfRenderFailed({
      adminId: 'adm-1',
      documentId: 'doc-x',
      documentNumber: 'SM-INV-000099',
      failureReason: 'S3 timeout',
      retryCount: 5,
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.templateKey).toBe(TAX_TEMPLATE_KEYS.admin.pdfRenderFailed);
    expect(call.eventId).toBe('doc-x');
  });
});

describe('TaxNotificationService — failure resilience', () => {
  it('does not throw when facade fails', async () => {
    const { service, notifications } = makeService();
    notifications.notifyFromTemplate.mockRejectedValue(new Error('queue down'));
    await expect(
      service.customerInvoiceIssued({
        customerId: 'u-1',
        documentId: 'doc-1',
        documentNumber: 'SM-INV-000001',
        documentTotalInPaise: 100n,
        documentDate: new Date(),
      }),
    ).resolves.toBeUndefined();
  });

  it('returns even when facade returns empty (template missing path)', async () => {
    const { service, notifications } = makeService();
    notifications.notifyFromTemplate.mockResolvedValue('');
    await expect(
      service.adminGstr8FilingReminder({
        adminId: 'adm-1',
        filingPeriod: '2026-04',
        daysUntilDue: 3,
        totalTcsInPaise: 100n,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('TaxNotificationService — money + date formatting', () => {
  it('renders crore-scale amounts with Indian grouping', async () => {
    const { service, notifications } = makeService();
    await service.sellerSettlementTcsCollected({
      sellerId: 'sel-1',
      settlementId: 'st-1',
      filingPeriod: '2026-04',
      tcsDeductedInPaise: 1_00_00_000_00n, // ₹1 crore
      netPayoutInPaise: 0n,
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.vars.tcsDeductedRupees).toBe('1,00,00,000.00');
  });

  it('handles negative refund amount with sign preservation', async () => {
    const { service, notifications } = makeService();
    await service.customerTimeBarredRefund({
      customerId: 'u-1',
      returnNumber: 'RET-X',
      refundAmountInPaise: -100n,
      walletAdjustmentId: 'adj-1',
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.vars.refundAmountRupees).toBe('-1.00');
  });

  it('formats IST date across day-boundary UTC', async () => {
    const { service, notifications } = makeService();
    // 31 Mar 2026 19:00 UTC = 1 Apr 2026 00:30 IST.
    await service.customerInvoiceIssued({
      customerId: 'u-1',
      documentId: 'doc-1',
      documentNumber: 'SM-INV-1',
      documentTotalInPaise: 100n,
      documentDate: new Date(Date.UTC(2026, 2, 31, 19, 0, 0)),
    });
    const call = notifications.notifyFromTemplate.mock.calls[0][0];
    expect(call.vars.documentDate).toBe('01-04-2026');
  });
});
