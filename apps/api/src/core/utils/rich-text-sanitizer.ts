// sanitize-html is a CJS module with a namespace export (IOptions
// type). The `import x = require()` form is the TS-idiomatic way to
// consume it while retaining namespace access, and is the pattern the
// library's own docs recommend.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sanitizeHtml = require('sanitize-html');

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote',
    'a',
    'span',
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
  },
  allowedSchemes: ['http', 'https'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: 'nofollow noopener',
        target: '_blank',
      },
    }),
  },
};

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Phase 49 (2026-05-21) — CMS profile for static-page body fields
 * (Terms, Privacy, Shipping, etc.).
 *
 * Allows everything the blog/rich-text profile allows, PLUS:
 *   - images and figure for inline media
 *   - tables (Privacy/Refund pages often use tables for jurisdictions)
 *   - code/pre blocks (rare but valid)
 *   - `dir` attribute on text blocks for RTL languages
 *
 * Blocks:
 *   - <script>, <iframe>, <object>, <embed>, <link>, <style>, <meta>
 *     (handled implicitly by the allowlist — anything not listed
 *     is stripped)
 *   - All event-handler attributes (onclick, onload, onerror, …)
 *     (sanitize-html strips unlisted attributes by default)
 *   - javascript: / data: / vbscript: schemes in href / src
 *     (via allowedSchemes)
 */
const CMS_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote',
    'a', 'span', 'div',
    'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
    'code', 'pre',
    'hr',
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target', 'title'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    span: ['class'],
    div: ['class'],
    p: ['class', 'dir'],
    h1: ['dir'], h2: ['dir'], h3: ['dir'], h4: ['dir'], h5: ['dir'], h6: ['dir'],
    table: ['class'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  // No data: / javascript: / vbscript: schemes admitted anywhere.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const isExternal =
        !!attribs.href &&
        /^https?:\/\//i.test(attribs.href) &&
        !attribs.href.toLowerCase().includes('sportsmart');
      return {
        tagName,
        attribs: {
          ...attribs,
          rel: isExternal ? 'nofollow noopener noreferrer' : (attribs.rel ?? ''),
          ...(isExternal ? { target: '_blank' } : {}),
        },
      };
    },
  },
};

export function sanitizeCmsBody(html: string): string {
  return sanitizeHtml(html, CMS_SANITIZE_OPTIONS);
}

/**
 * Phase 185 (#3) — notification EMAIL template profile.
 *
 * Notification templates are admin-authored, heavily inline-styled HTML
 * email shells (tables, spans, `style="..."`). The CMS profile strips
 * `style`, which would destroy them — so this profile is deliberately
 * permissive about *presentation* (keeps `style`, layout tags, tables,
 * images, the `{{var}}` placeholders) while still removing the genuine
 * XSS vectors an admin (or a compromised admin token) could embed:
 *
 *   - <script>, <style>, <iframe>, <object>, <embed>, <link>, <meta>,
 *     <base>, <form>, <input> (tag allowlist — anything unlisted is
 *     dropped; script/style content is discarded entirely)
 *   - on* event-handler attributes (attribute allowlist drops them)
 *   - javascript: / vbscript: / data: schemes in href/src
 *   - CSS `expression()` / `javascript:` inside style values (post-pass)
 *
 * The renderer already HTML-escapes `{{var}}` substitutions, so customer
 * data can't inject markup at render time; this guards the *static body*.
 */
const EMAIL_TEMPLATE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'small', 'sub', 'sup',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre',
    'a', 'span', 'div',
    'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
    'center',
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'align', 'valign', 'width', 'height', 'dir', 'bgcolor'],
    a: ['href', 'rel', 'target', 'title', 'style', 'class'],
    img: ['src', 'alt', 'width', 'height', 'style', 'class'],
    table: ['style', 'class', 'width', 'cellpadding', 'cellspacing', 'border', 'align', 'bgcolor'],
    td: ['style', 'class', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
    th: ['style', 'class', 'colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'],
    col: ['span', 'width', 'style'],
  },
  // Allow scheme-less (relative / `{{placeholder}}`) URLs to survive, plus
  // the safe schemes. NO javascript:/data:/vbscript:.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  // Keep `{{orderUrl}}`-style placeholder hrefs (sanitize-html treats them
  // as relative and keeps them by default).
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener', target: attribs.target ?? '_blank' },
    }),
  },
};

export function sanitizeEmailTemplateBody(html: string): string {
  const cleaned = sanitizeHtml(html, EMAIL_TEMPLATE_SANITIZE_OPTIONS);
  // Defence-in-depth: neutralise any residual script-y tokens that can hide
  // inside a surviving style attribute (e.g. `style="background:expression(...)"`).
  return cleaned
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    .replace(/expression\s*\(/gi, '');
}

/**
 * Phase 49 — for fields that are rendered as plain text inside
 * attributes (metaTitle / metaDesc / FAQ answer when not rich-text).
 * Strips ALL HTML tags AND collapses whitespace, but does NOT
 * HTML-escape — the consumer's renderer is expected to escape.
 */
export function stripHtmlToPlainText(input: string): string {
  return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

export function isRichTextEmpty(sanitizedHtml: string): boolean {
  const plainText = sanitizedHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return plainText.length === 0;
}

export function getPlainTextLength(sanitizedHtml: string): number {
  return sanitizedHtml
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
    .length;
}
