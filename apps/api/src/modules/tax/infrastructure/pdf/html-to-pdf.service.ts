// Real HTML → PDF rendering via headless Chromium (Puppeteer).
//
// The tax-document pipeline stores invoices as HTML (see
// tax-document-pdf.service). For the customer "download" surface we want a
// genuine, printable PDF — and, for multi-seller orders, ALL of that order's
// per-seller invoices bundled into ONE downloadable file (each invoice on its
// own page; they remain legally distinct invoices, GST just forbids merging
// two different GSTINs into a single invoice document).
//
// One shared browser is launched lazily and reused across requests (launching
// Chromium per request is ~300ms+ of pure overhead). Each render gets a fresh
// page so concurrent requests don't trample one another. If Chromium can't be
// launched (e.g. a deploy without the browser installed) render() throws a
// clear error the controller maps to 503 instead of crashing the process.

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import puppeteer, { type Browser } from 'puppeteer';

@Injectable()
export class HtmlToPdfService implements OnModuleDestroy {
  private readonly logger = new Logger(HtmlToPdfService.name);
  private browser?: Browser;
  // De-dupes concurrent first-launch attempts into a single browser.
  private launching?: Promise<Browser>;

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    if (this.launching) return this.launching;
    this.launching = puppeteer
      .launch({
        headless: true,
        // --no-sandbox is required when the API runs as root in a container;
        // harmless on a dev Mac. We never load untrusted remote pages here
        // (only our own server-rendered invoice HTML via setContent).
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      .then((b) => {
        this.browser = b;
        this.launching = undefined;
        // If Chromium dies (crash / OOM), drop the handle so the next
        // render() relaunches instead of reusing a dead browser.
        b.on('disconnected', () => {
          if (this.browser === b) this.browser = undefined;
        });
        this.logger.log('Headless Chromium launched for PDF rendering.');
        return b;
      })
      .catch((err) => {
        this.launching = undefined;
        throw err;
      });
    return this.launching;
  }

  /**
   * Render a complete HTML document to an A4 PDF buffer. `html` must be a
   * full, self-contained document (inline styles — no external assets are
   * fetched). Page breaks are honoured, so callers can stitch several
   * documents together with `page-break-after: always`.
   */
  async render(
    html: string,
    // Optional explicit page size (e.g. a 4x6 shipping label). When omitted,
    // the default A4 + invoice margins are used (tax-invoice callers unchanged).
    opts?: { width?: string; height?: string; pageRanges?: string },
  ): Promise<Buffer> {
    let browser: Browser;
    try {
      browser = await this.getBrowser();
    } catch (err) {
      this.logger.error(
        `Chromium launch failed — cannot render PDF: ${(err as Error)?.message}`,
      );
      throw new ServiceUnavailableException(
        'PDF rendering is temporarily unavailable. Please try again shortly.',
      );
    }

    const page = await browser.newPage();
    try {
      // `load` (not networkidle) — the invoice HTML is self-contained with
      // inline CSS, so there are no network requests to idle on.
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf(
        opts?.width && opts?.height
          ? {
              width: opts.width,
              height: opts.height,
              printBackground: true,
              margin: { top: 0, bottom: 0, left: 0, right: 0 },
              // Single-page guard for fixed-size labels (e.g. 4x6): without it a
              // long address can push content a hair past the page and Puppeteer
              // emits a near-blank 2nd page. Multi-page callers (tax invoices)
              // use the A4 branch below and never set this.
              ...(opts.pageRanges ? { pageRanges: opts.pageRanges } : {}),
            }
          : {
              format: 'A4',
              printBackground: true,
              margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
            },
      );
      // puppeteer returns a Uint8Array; normalise to Buffer for Nest/Express.
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
  }
}
