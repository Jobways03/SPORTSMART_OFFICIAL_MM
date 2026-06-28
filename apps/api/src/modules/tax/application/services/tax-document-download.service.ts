// Phase 20 GST — TaxDocumentDownloadService.
//
// The authorisation + audit wrapper around
// TaxDocumentPdfService.getSignedDownloadUrl. Every download attempt
// (success OR denial) writes a row to `tax_document_download_audits`
// so forensic + flooding-detection queries have a stable trail.
//
// Scope rules (CA-confirmable; defaults follow GST audit conventions):
//
//   CUSTOMER — may download any document where `customerId = actor.userId`
//             AND status = PDF_GENERATED. Cannot see others' invoices.
//
//   SELLER   — may download any document where `sellerId = actor.sellerId`
//             AND status = PDF_GENERATED. Cannot see a buyer's POV of
//             a different seller's invoice.
//
//   FRANCHISE — same as SELLER (franchise fulfilment is a supplier-side
//              role).
//
//   ADMIN    — may download any non-VOIDED_DRAFT document. We log the
//             admin ID + role so the audit ledger captures internal
//             access. Permission check (`tax.invoice.read` or
//             `tax.invoice.download`) is the controller's job; the
//             service trusts an ADMIN actor and audits the access.
//
//   SYSTEM   — internal callers (cron jobs, settlement render, etc.).
//             No scope check; an audit row still lands so the access
//             is traceable.
//
// Rate limiting: per-(actor, document) recent-download cap. Default
// 20 downloads in 5 minutes. Caps + window are env-tunable. A denied
// request still writes a DENIED_RATE_LIMIT audit row so abuse leaves
// a trail.

import { Injectable, Logger } from '@nestjs/common';
import type {
  TaxDocument,
  TaxDocumentActorType,
  TaxDocumentDownloadOutcome,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import {
  TaxDocumentPdfService,
  PdfDocumentNotFoundError,
} from './tax-document-pdf.service';
import { isPdfDownloadable } from '../../domain/tax-document-state-machine';

export class TaxDocumentDownloadDeniedError extends Error {
  constructor(
    public readonly outcome: TaxDocumentDownloadOutcome,
    public readonly reason: string,
  ) {
    super(`Download denied (${outcome}): ${reason}`);
    this.name = 'TaxDocumentDownloadDeniedError';
  }
}

export interface DownloadActor {
  type: TaxDocumentActorType;
  id: string;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export interface DownloadResult {
  url: string;
  documentNumber: string;
  documentId: string;
  expiresInSeconds: number;
}

@Injectable()
export class TaxDocumentDownloadService {
  private readonly logger = new Logger(TaxDocumentDownloadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly pdfService: TaxDocumentPdfService,
  ) {}

  private rateLimitCap(): number {
    return this.env.getNumber('TAX_DOWNLOAD_RATE_LIMIT_PER_WINDOW', 20);
  }

  private rateLimitWindowMinutes(): number {
    return this.env.getNumber('TAX_DOWNLOAD_RATE_LIMIT_WINDOW_MINUTES', 5);
  }

  private defaultTtlSeconds(): number {
    return this.env.getNumber('TAX_DOWNLOAD_SIGNED_URL_TTL_SECONDS', 300);
  }

  /**
   * Authorise + issue + audit. Throws TaxDocumentDownloadDeniedError
   * on any denial (caller maps to HTTP 403/404/429). All outcomes
   * (allowed or denied) produce an audit row.
   */
  async issueDownloadUrl(args: {
    documentId: string;
    actor: DownloadActor;
    expiresInSeconds?: number;
  }): Promise<DownloadResult> {
    const ttl = args.expiresInSeconds ?? this.defaultTtlSeconds();

    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: args.documentId },
      select: {
        id: true,
        documentNumber: true,
        status: true,
        pdfStoragePath: true,
        customerId: true,
        sellerId: true,
        // Franchise-fulfilled invoices are written with sellerId=null;
        // the franchise lives on the linked SubOrder. We need this for
        // the FRANCHISE-actor scope check (see scopeViolation below).
        subOrderId: true,
      },
    });
    if (!doc) throw new PdfDocumentNotFoundError(args.documentId);

    // 1. Status guard — VOIDED_DRAFT / SUPERSEDED are never legally
    //    issued; we don't even let admins download them via this
    //    endpoint (the admin tool that needs them uses a separate
    //    forensic path with its own audit shape).
    if (doc.status === 'VOIDED_DRAFT' || doc.status === 'SUPERSEDED') {
      await this.writeAudit({
        documentId: doc.id,
        actor: args.actor,
        outcome: 'DENIED_VOIDED',
        denyReason: `Document status ${doc.status} is not legally issued`,
        ttlSeconds: ttl,
      });
      throw new TaxDocumentDownloadDeniedError(
        'DENIED_VOIDED',
        `Document ${doc.documentNumber} is ${doc.status} and not downloadable.`,
      );
    }

    // 2. Scope guard.
    const scopeReason = await this.scopeViolation(doc, args.actor);
    if (scopeReason) {
      await this.writeAudit({
        documentId: doc.id,
        actor: args.actor,
        outcome: 'DENIED_SCOPE',
        denyReason: scopeReason,
        ttlSeconds: ttl,
      });
      throw new TaxDocumentDownloadDeniedError(
        'DENIED_SCOPE',
        scopeReason,
      );
    }

    // 3. PDF readiness — the PDF service does its own check, but we
    //    surface a richer audit outcome here. A rendered PDF stays
    //    downloadable after a credit note reverses the invoice
    //    (PARTIALLY_REVERSED / FULLY_REVERSED), so gate on
    //    isPdfDownloadable rather than PDF_GENERATED alone.
    if (!isPdfDownloadable(doc.status, doc.pdfStoragePath)) {
      await this.writeAudit({
        documentId: doc.id,
        actor: args.actor,
        outcome: 'DENIED_NOT_READY',
        denyReason: `Document status ${doc.status} — PDF not yet rendered`,
        ttlSeconds: ttl,
      });
      throw new TaxDocumentDownloadDeniedError(
        'DENIED_NOT_READY',
        `Document ${doc.documentNumber} has no rendered PDF yet (status ${doc.status}).`,
      );
    }

    // 4. Rate limit — count recent ALLOWED downloads in the window.
    //    SYSTEM actors bypass the rate limit (cron jobs / internal
    //    services aren't user-visible).
    if (args.actor.type !== 'SYSTEM') {
      const exceeded = await this.rateLimitExceeded(doc.id, args.actor);
      if (exceeded) {
        await this.writeAudit({
          documentId: doc.id,
          actor: args.actor,
          outcome: 'DENIED_RATE_LIMIT',
          denyReason: `Exceeded ${this.rateLimitCap()} downloads in ${this.rateLimitWindowMinutes()}min`,
          ttlSeconds: ttl,
        });
        throw new TaxDocumentDownloadDeniedError(
          'DENIED_RATE_LIMIT',
          `Too many download requests for ${doc.documentNumber}. Try again in a few minutes.`,
        );
      }
    }

    // 5. Issue the URL via the PDF service. Increments downloadCount
    //    + lastDownloadedAt.
    const issued = await this.pdfService.getSignedDownloadUrl({
      documentId: doc.id,
      expiresInSeconds: ttl,
    });

    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.writeAudit({
      documentId: doc.id,
      actor: args.actor,
      outcome: 'ALLOWED',
      denyReason: null,
      issuedUrl: issued.url,
      urlExpiresAt: expiresAt,
      ttlSeconds: ttl,
    });

    return {
      url: issued.url,
      documentNumber: issued.documentNumber,
      documentId: doc.id,
      expiresInSeconds: ttl,
    };
  }

  // ── Internals ───────────────────────────────────────────────────

  private async scopeViolation(
    doc: { customerId: string | null; sellerId: string | null; subOrderId: string | null },
    actor: DownloadActor,
  ): Promise<string | null> {
    switch (actor.type) {
      case 'CUSTOMER':
        // Follow-up #133 — POS invoices have customerId=null (walk-in).
        // A logged-in CUSTOMER can never be the scoped recipient of a
        // walk-in POS invoice, so treat null customerId as a deny.
        if (doc.customerId === null) {
          return `Customer ${actor.id} cannot access POS / walk-in invoice (no scoped customer)`;
        }
        return doc.customerId === actor.id
          ? null
          : `Customer ${actor.id} cannot access invoice of customer ${doc.customerId}`;
      case 'SELLER':
        return doc.sellerId === actor.id
          ? null
          : `SELLER ${actor.id} cannot access invoice with sellerId ${doc.sellerId ?? '(null)'}`;
      case 'FRANCHISE': {
        // Franchise-fulfilled invoices write sellerId=null and keep the
        // franchise on the linked SubOrder. Accept either path so future
        // backfills that populate sellerId for FRANCHISE supplier docs
        // also work without a code change.
        if (doc.sellerId === actor.id) return null;
        if (!doc.subOrderId) {
          return `FRANCHISE ${actor.id} cannot access invoice with sellerId ${doc.sellerId ?? '(null)'} (no subOrder link)`;
        }
        const subOrder = await this.prisma.subOrder.findUnique({
          where: { id: doc.subOrderId },
          select: { franchiseId: true },
        });
        return subOrder?.franchiseId === actor.id
          ? null
          : `FRANCHISE ${actor.id} cannot access invoice owned by franchise ${subOrder?.franchiseId ?? '(unset)'}`;
      }
      case 'ADMIN':
      case 'SYSTEM':
        return null;
      default:
        return `Unknown actor type ${actor.type}`;
    }
  }

  private async rateLimitExceeded(
    documentId: string,
    actor: DownloadActor,
  ): Promise<boolean> {
    const windowMs = this.rateLimitWindowMinutes() * 60 * 1000;
    const cutoff = new Date(Date.now() - windowMs);
    const count = await this.prisma.taxDocumentDownloadAudit.count({
      where: {
        taxDocumentId: documentId,
        actorType: actor.type,
        actorId: actor.id,
        outcome: 'ALLOWED',
        createdAt: { gte: cutoff },
      },
    });
    return count >= this.rateLimitCap();
  }

  private async writeAudit(args: {
    documentId: string;
    actor: DownloadActor;
    outcome: TaxDocumentDownloadOutcome;
    denyReason: string | null;
    issuedUrl?: string;
    urlExpiresAt?: Date;
    ttlSeconds: number;
  }): Promise<void> {
    try {
      await this.prisma.taxDocumentDownloadAudit.create({
        data: {
          taxDocumentId: args.documentId,
          actorType: args.actor.type,
          actorId: args.actor.id,
          actorRole: args.actor.role ?? null,
          outcome: args.outcome,
          denyReason: args.denyReason,
          issuedUrl: args.issuedUrl ?? null,
          urlExpiresAt: args.urlExpiresAt ?? null,
          ttlSeconds: args.ttlSeconds,
          ipAddress: args.actor.ip ?? null,
          userAgent: args.actor.userAgent ?? null,
        },
      });
    } catch (err) {
      // Audit write must NOT block the actual outcome (deny still
      // throws even if we couldn't log it). Surface to ops via the
      // logger so the gap is visible.
      this.logger.error(
        `Failed to write download audit for ${args.documentId}: ${(err as Error).message}`,
      );
    }
  }
}
