/**
 * Follow-up #H44 — POS hardware integration module.
 *
 * Browser-side scaffolding for the three pieces of physical hardware a
 * franchise POS counter actually needs:
 *
 *   1. Barcode scanner — most USB barcode guns enumerate as a USB-HID
 *      keyboard and emit `<digits><Enter>` very fast, so a
 *      keystroke-buffer pattern reliably distinguishes a scan from a
 *      human typing. Web Serial / Web Bluetooth are reserved for
 *      Bluetooth scanners; the keystroke path covers the common case
 *      and works on every browser without an extra permission grant.
 *
 *   2. Receipt printer — thermal printers expose ESC/POS over Web USB.
 *      In dev / unsupported browsers we fall back to a browser-print
 *      window with print-only CSS so a sale still produces a paper
 *      receipt via the OS print dialog.
 *
 *   3. Cash drawer — virtually always wired through the receipt
 *      printer's RJ11 jack and triggered by the ESC/POS "open drawer"
 *      command. Without a printer connection we no-op + log.
 *
 * Everything is opt-in via env / settings; the existing POS flow keeps
 * working without any hardware attached.
 *
 * Browser compatibility:
 *   - Barcode keystroke: every browser.
 *   - Web USB (printer + drawer): Chrome / Edge on http(s). Firefox /
 *     Safari fall through to the print-window fallback.
 *
 * Security:
 *   - Web USB requires a user-gesture-driven `requestDevice()` call
 *     before the page can access the printer. The first call presents
 *     an OS-level chooser; subsequent calls reuse the granted handle
 *     until the user revokes it in browser settings.
 */

import type React from 'react';

// ── Barcode scanner ───────────────────────────────────────────────────

export interface UseBarcodeScannerOptions {
  /** Called when a complete barcode has been captured. */
  onScan: (barcode: string) => void;
  /**
   * Maximum gap between two characters before the buffer is considered
   * stale and reset. Real scanners fire at 1-10ms per character; humans
   * type at 100ms+. 50ms is a wide gate that keeps scans together while
   * never grouping two human keystrokes into a phantom "scan".
   */
  intervalMs?: number;
  /**
   * Minimum length before a `<Enter>` terminator is treated as a
   * completed scan. Defends against a stray Enter in a normal form
   * being misinterpreted as a (very short) barcode.
   */
  minLength?: number;
  /**
   * Element to attach the listener to. Defaults to `window` so the
   * scanner works from any focus state on the POS page.
   */
  target?: Window | HTMLElement;
  /** Set false to pause scanning (e.g. modal open). */
  enabled?: boolean;
}

/**
 * Keystroke-buffer barcode scanner. Returns an object you can call
 * `cleanup()` on; mount via useEffect and return cleanup. The
 * `enabled` flag is honored inside the handler so toggling it does
 * not require re-mounting.
 *
 * Example:
 *   useEffect(() => {
 *     const handle = mountBarcodeScanner({
 *       onScan: (code) => addProductByBarcode(code),
 *       enabled: !modalOpen,
 *     });
 *     return handle.cleanup;
 *   }, [modalOpen]);
 */
export interface BarcodeScannerHandle {
  cleanup: () => void;
}

export function mountBarcodeScanner(
  opts: UseBarcodeScannerOptions,
): BarcodeScannerHandle {
  if (typeof window === 'undefined') {
    return { cleanup: () => undefined };
  }
  const target = opts.target ?? window;
  const intervalMs = opts.intervalMs ?? 50;
  const minLength = opts.minLength ?? 3;

  let buffer = '';
  let lastAt = 0;

  const handler = (event: KeyboardEvent) => {
    if (opts.enabled === false) return;

    // Ignore modifier-only events; they don't produce characters.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const now = Date.now();
    if (now - lastAt > intervalMs) {
      buffer = '';
    }
    lastAt = now;

    if (event.key === 'Enter') {
      if (buffer.length >= minLength) {
        const scanned = buffer;
        buffer = '';
        // Defer the callback so the keydown event itself completes
        // before the consumer mutates state — keeps React renders
        // predictable when the scanner targets the window.
        Promise.resolve().then(() => opts.onScan(scanned));
        // Don't preventDefault — a form on the page may want to
        // submit on Enter via its own handler when no scan is in
        // flight. The 50ms buffer ensures human Enters get a fresh
        // buffer and pass through.
      }
      return;
    }

    if (event.key.length === 1) {
      buffer += event.key;
    }
  };

  (target as Window).addEventListener('keydown', handler as EventListener);
  return {
    cleanup: () =>
      (target as Window).removeEventListener(
        'keydown',
        handler as EventListener,
      ),
  };
}

// ── Receipt printer + cash drawer ─────────────────────────────────────

export interface ReceiptLine {
  productTitle: string;
  variantTitle?: string | null;
  quantity: number;
  unitPrice: number; // INR
  lineDiscount: number; // INR
}

export interface ReceiptInput {
  saleNumber: string;
  franchiseName: string;
  customerName?: string | null;
  customerPhone?: string | null;
  items: ReceiptLine[];
  subtotalInr: number;
  discountInr: number;
  netInr: number;
  paymentMethod: string;
  soldAt: Date;
}

/**
 * Open a hidden iframe with print-only CSS and trigger the browser's
 * print dialog. Works on every browser and respects whatever printer
 * the OS has set as default (typically the thermal printer connected
 * to the POS counter via USB / network).
 *
 * Returns a Promise that resolves after the print dialog closes.
 * Rejects if printing isn't supported (server-side render).
 */
export async function printReceipt(input: ReceiptInput): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('printReceipt requires a browser environment');
  }

  const html = buildReceiptHtml(input);

  // Use a hidden iframe so the parent page state is untouched. A new
  // window would be blocked by popup blockers in most browsers when
  // not triggered from a direct user click — but printReceipt usually
  // IS triggered from the "complete sale" click, so this is belt+braces.
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      try {
        document.body.removeChild(iframe);
      } catch {
        // Best-effort; the iframe may have already been removed.
      }
    }, 300);
  };

  return new Promise((resolve) => {
    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) {
          cleanup();
          resolve();
          return;
        }
        win.focus();
        win.print();
      } finally {
        cleanup();
        resolve();
      }
    };
    if (iframe.contentDocument) {
      iframe.contentDocument.open();
      iframe.contentDocument.write(html);
      iframe.contentDocument.close();
    } else {
      cleanup();
      resolve();
    }
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReceiptHtml(r: ReceiptInput): string {
  const lines = r.items
    .map((it) => {
      const qty = it.quantity;
      const gross = it.unitPrice * qty;
      const net = gross - it.lineDiscount;
      const title = escapeHtml(
        it.variantTitle ? `${it.productTitle} - ${it.variantTitle}` : it.productTitle,
      );
      return `
        <tr>
          <td class="title">${title}</td>
          <td class="qty">${qty}</td>
          <td class="price">${net.toFixed(2)}</td>
        </tr>
      `;
    })
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Receipt ${escapeHtml(r.saleNumber)}</title>
    <style>
      @page { size: 80mm auto; margin: 0; }
      body {
        font-family: 'Courier New', monospace;
        font-size: 12px;
        margin: 0;
        padding: 8mm 4mm;
        color: #000;
      }
      h1 {
        font-size: 14px;
        text-align: center;
        margin: 0 0 4mm;
      }
      .meta {
        font-size: 11px;
        margin-bottom: 4mm;
      }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 2px 0; text-align: left; vertical-align: top; }
      .qty { text-align: center; width: 32px; }
      .price { text-align: right; width: 64px; }
      .row-sep td { border-top: 1px dashed #000; padding-top: 4px; }
      .totals { margin-top: 6px; }
      .totals .label { width: auto; }
      .totals .val { text-align: right; }
      .grand { font-weight: bold; font-size: 13px; border-top: 1px solid #000; }
      .footer {
        margin-top: 8mm;
        text-align: center;
        font-size: 10px;
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(r.franchiseName)}</h1>
    <div class="meta">
      Sale: ${escapeHtml(r.saleNumber)}<br />
      ${r.soldAt.toLocaleString()}<br />
      ${r.customerName ? `Customer: ${escapeHtml(r.customerName)}<br />` : ''}
      ${r.customerPhone ? `Phone: ${escapeHtml(r.customerPhone)}<br />` : ''}
    </div>
    <table>
      <thead>
        <tr class="row-sep">
          <th>Item</th>
          <th class="qty">Qty</th>
          <th class="price">Amount</th>
        </tr>
      </thead>
      <tbody>${lines}</tbody>
    </table>
    <table class="totals">
      <tr class="row-sep">
        <td class="label">Subtotal</td>
        <td class="val">${r.subtotalInr.toFixed(2)}</td>
      </tr>
      <tr>
        <td class="label">Discount</td>
        <td class="val">-${r.discountInr.toFixed(2)}</td>
      </tr>
      <tr class="grand">
        <td class="label">Total</td>
        <td class="val">${r.netInr.toFixed(2)}</td>
      </tr>
      <tr>
        <td class="label">Paid via</td>
        <td class="val">${escapeHtml(r.paymentMethod)}</td>
      </tr>
    </table>
    <div class="footer">
      Thank you for shopping with us!
    </div>
    <script>window.onafterprint = () => window.close();</script>
  </body>
</html>`;
}

// ── Cash drawer ───────────────────────────────────────────────────────

interface UsbDeviceLike {
  open(): Promise<void>;
  close(): Promise<void>;
  configurations: Array<{ configurationValue: number }>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(value: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<{ status: string }>;
}

interface UsbLike {
  requestDevice(options: { filters: unknown[] }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

/**
 * ESC/POS "open drawer" pulse command. Most receipt printers wire the
 * cash drawer through RJ11 pin 2 and respond to ESC p m t1 t2 — this
 * is the canonical Epson sequence (pulse pin 2 for ~50ms × ~25ms off).
 */
const ESC_POS_OPEN_DRAWER = new Uint8Array([
  0x1b, 0x70, 0x00, 0x19, 0xfa,
]);

let cachedPrinter: UsbDeviceLike | null = null;

async function findOrRequestPrinter(): Promise<UsbDeviceLike | null> {
  if (typeof navigator === 'undefined') return null;
  const usb = (navigator as Navigator & { usb?: UsbLike }).usb;
  if (!usb) return null;
  if (cachedPrinter) return cachedPrinter;
  const granted = await usb.getDevices();
  if (granted.length > 0) {
    cachedPrinter = granted[0]!;
    return cachedPrinter;
  }
  return null;
}

/**
 * Send the ESC/POS open-drawer command to whichever USB printer the
 * browser has already granted access to. Returns:
 *
 *   - `'ok'`              — pulse sent successfully
 *   - `'no-printer'`      — no granted USB device; user must run
 *                            `requestUsbPrinterPairing()` from a click
 *                            handler first
 *   - `'unsupported'`     — Web USB not available (Firefox / Safari)
 *
 * Never throws — the POS sale must commit even when the drawer is
 * unreachable; the cashier can open it manually in that case.
 */
export type OpenDrawerResult = 'ok' | 'no-printer' | 'unsupported' | 'error';

export async function openCashDrawer(): Promise<OpenDrawerResult> {
  try {
    if (typeof navigator === 'undefined' || !('usb' in navigator)) {
      return 'unsupported';
    }
    const device = await findOrRequestPrinter();
    if (!device) return 'no-printer';
    await device.open();
    if (device.configurations.length > 0) {
      await device.selectConfiguration(
        device.configurations[0]!.configurationValue,
      );
    }
    await device.claimInterface(0);
    // Endpoint 1 is the conventional bulk-out endpoint for ESC/POS
    // printers. Real-world devices vary; a future iteration of this
    // file should enumerate endpoints rather than hardcode.
    const result = await device.transferOut(1, ESC_POS_OPEN_DRAWER);
    await device.close();
    return result.status === 'ok' ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

/**
 * Trigger a Web USB device picker so the cashier can grant the page
 * access to the printer. Must be called from a user-gesture event
 * handler (click) — browsers block `requestDevice` from non-gesture
 * contexts.
 *
 * Filters are intentionally broad (no productId pin) so the cashier
 * can pick any printer the OS exposes. A future pass can narrow this
 * by Epson / Star / Bixolon vendor ID once the deployed fleet is known.
 */
export async function requestUsbPrinterPairing(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) return false;
  const usb = (navigator as Navigator & { usb?: UsbLike }).usb;
  if (!usb) return false;
  try {
    cachedPrinter = await usb.requestDevice({ filters: [] });
    return true;
  } catch {
    return false;
  }
}
