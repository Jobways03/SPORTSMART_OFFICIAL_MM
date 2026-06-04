import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel } from '@prisma/client';

export interface RenderOptions {
  /** Channel decides escaping: EMAIL → HTML-escape; SMS/WHATSAPP → plain. */
  channel?: NotificationChannel;
}

/**
 * Minimal Handlebars-style renderer. Replaces `{{varName}}` (and dotted
 * paths like `{{user.firstName}}`) in a string with values from a
 * variables object. No conditionals / helpers / loops — keep it small;
 * if we later need full Handlebars, swap the impl behind this same API.
 *
 * Phase 188 (#1) — this is DELIBERATELY not full Handlebars: a string-
 * replace renderer has no helper/partial/prototype surface, so there is no
 * code-execution or `__proto__` lookup risk. `validateSyntax()` rejects
 * unsupported `{{#if}}`/`{{#each}}`/helper/partial syntax at SAVE time so an
 * admin can never persist a template that would silently fail to render.
 *
 * Missing variables render as empty strings + log a warning so editors
 * can spot template/payload drift.
 *
 * HTML safety
 * -----------
 * Default `{{var}}` substitution is **HTML-escaped** so untrusted user
 * input (seller shop names, customer names, product titles, order
 * numbers) cannot inject `<script>` or other HTML into rendered email
 * bodies. Use the Handlebars-style triple-brace `{{{var}}}` to emit
 * raw HTML — only for values that the platform itself constructs
 * (system-generated links, signed buttons, admin-authored rich text
 * that has already been sanitised upstream).
 *
 * Plain-text templates still pass through `render()` and get the same
 * escaping; the encoding is a superset of safe ASCII so plain-text
 * email bodies remain legible.
 */
@Injectable()
export class TemplateRenderer {
  private readonly logger = new Logger(TemplateRenderer.name);

  // Match {{{var}}} (raw) before {{var}} (escaped). The order matters —
  // run the triple-brace pattern first so doubled braces inside it
  // aren't consumed by the double-brace handler.
  private static readonly RAW_PATTERN = /{{{\s*([\w.]+)\s*}}}/g;
  private static readonly ESCAPED_PATTERN = /{{\s*([\w.]+)\s*}}/g;

  render(
    template: string,
    vars: Record<string, unknown>,
    opts?: RenderOptions,
  ): string {
    // Phase 188 (#8) — plain-text channels (SMS/WhatsApp) must NOT get HTML
    // entity escaping (`&` → `&amp;` would show literally in an SMS). Only
    // EMAIL escapes; plain channels strip control chars instead.
    const plainText = opts?.channel === 'SMS' || opts?.channel === 'WHATSAPP';

    const withRaw = template.replace(TemplateRenderer.RAW_PATTERN, (_m, path) => {
      const value = this.resolvePath(vars, path);
      if (value == null) {
        this.logger.debug(`template raw var missing: ${path}`);
        return '';
      }
      const s = String(value);
      return plainText ? TemplateRenderer.stripControlChars(s) : s;
    });
    return withRaw.replace(TemplateRenderer.ESCAPED_PATTERN, (_m, path) => {
      const value = this.resolvePath(vars, path);
      if (value == null) {
        this.logger.debug(`template var missing: ${path}`);
        return '';
      }
      const s = String(value);
      return plainText
        ? TemplateRenderer.stripControlChars(s)
        : TemplateRenderer.escapeHtml(s);
    });
  }

  /**
   * Phase 188 (#1) — reject Handlebars constructs the minimal renderer does
   * NOT support, so they're caught at save/preview instead of silently
   * rendering as literal text. Returns a list of human-readable issues
   * (empty = OK). Supported: `{{ var }}`, `{{ a.b.c }}`, `{{{ var }}}`.
   */
  validateSyntax(template: string): string[] {
    const issues = new Set<string>();
    if (!template) return [];

    // Block helpers ({{#if}}, {{#each}}, {{/if}}) + partials ({{> x}}).
    const blocks = template.match(/\{\{\s*[#/>][^}]*\}\}/g);
    if (blocks) {
      issues.add(
        `Unsupported block/partial syntax (${unique(blocks).join(', ')}). Only ` +
          `{{var}} and {{{var}}} are supported — no {{#if}}/{{#each}}/helpers/partials.`,
      );
    }
    if (/\{\{\s*else\s*\}\}/.test(template)) {
      issues.add('Unsupported {{else}} — conditionals are not supported.');
    }

    // Any remaining moustache whose inner isn't a simple dotted path
    // (e.g. a helper call "{{formatDate x}}" with a space).
    const noTriple = template.replace(/\{\{\{\s*[\w.]+\s*\}\}\}/g, '');
    const tokens = noTriple.match(/\{\{\s*[^{}]+?\s*\}\}/g) ?? [];
    for (const tok of tokens) {
      const inner = tok.replace(/^\{\{\s*|\s*\}\}$/g, '');
      if (/^[#/>]/.test(inner) || inner === 'else') continue; // already flagged
      if (!/^[\w.]+$/.test(inner)) {
        issues.add(
          `Unsupported expression "{{${inner}}}" — only simple {{var}} / {{a.b}} ` +
            `paths are supported (no helpers, arguments or spaces).`,
        );
      }
    }
    return [...issues];
  }

  /**
   * Phase 188 (#16) — every distinct variable path the template references
   * (both {{var}} and {{{var}}}). Used by preview to surface which of them
   * the admin's sample payload didn't fill.
   */
  referencedVars(template: string): string[] {
    const out = new Set<string>();
    for (const src of [TemplateRenderer.RAW_PATTERN, TemplateRenderer.ESCAPED_PATTERN]) {
      const re = new RegExp(src.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(template)) !== null) {
        if (m[1]) out.add(m[1]);
      }
    }
    return [...out];
  }

  /** Resolve a single dotted path (exposed for preview missing-var checks). */
  resolve(vars: Record<string, unknown>, path: string): unknown {
    return this.resolvePath(vars, path);
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
  }

  // ── Phase 185 (#14) — internal-field stripping ────────────────────────
  //
  // Keys that must NEVER be substituted into a customer-facing render,
  // regardless of whether a template references them. Matches the
  // convention used elsewhere (`internal*`, `_*`) plus an explicit
  // denylist of known admin-only payload fields.
  private static readonly INTERNAL_KEY_PATTERNS = [
    /^_/,
    /^internal/i,
    /internalnotes?$/i,
    /^riskscore$/i,
    /^fraud/i,
    /^admin/i,
  ];

  static isInternalKey(key: string): boolean {
    return TemplateRenderer.INTERNAL_KEY_PATTERNS.some((re) => re.test(key));
  }

  /**
   * Return a shallow copy of `vars` with internal-only keys removed (top
   * level + one level deep for nested objects). Used on the customer
   * render path so admin context can't leak into an outbound message.
   */
  static stripInternalVars(
    vars: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(vars)) {
      if (TemplateRenderer.isInternalKey(k)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = TemplateRenderer.stripInternalVars(v as Record<string, unknown>);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  // ── Phase 185 (#6) — required-variable validation ─────────────────────
  //
  // `variablesSchema` is a loose JSON object; we honour a `required:
  // string[]` array (a minimal subset of JSON Schema). Returns the list of
  // required dotted-paths that are absent/empty in the payload so callers
  // can fail fast instead of shipping "Hi {{customerName}}".
  findMissingRequiredVars(
    variablesSchema: unknown,
    vars: Record<string, unknown>,
  ): string[] {
    const required = TemplateRenderer.extractRequired(variablesSchema);
    if (required.length === 0) return [];
    return required.filter((path) => {
      const value = this.resolvePath(vars, path);
      return value == null || String(value).trim() === '';
    });
  }

  private static extractRequired(schema: unknown): string[] {
    if (!schema || typeof schema !== 'object') return [];
    const req = (schema as Record<string, unknown>).required;
    if (!Array.isArray(req)) return [];
    return req.filter((x): x is string => typeof x === 'string');
  }

  /**
   * Replace the five characters that have special meaning in HTML
   * (`&`, `<`, `>`, `"`, `'`) with their entity equivalents. Covers the
   * standard OWASP set for HTML body / attribute contexts. Keep this
   * inline (no `escape-html` dep) so the renderer stays zero-dep.
   */
  private static escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Phase 188 (#8) — plain-text channels: drop ASCII control chars (except
   * \n, \r, \t) that a malicious/garbled value could smuggle into an SMS.
   */
  private static stripControlChars(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
