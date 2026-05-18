import { Injectable, Logger } from '@nestjs/common';

/**
 * Minimal Handlebars-style renderer. Replaces `{{varName}}` (and dotted
 * paths like `{{user.firstName}}`) in a string with values from a
 * variables object. No conditionals / helpers / loops — keep it small;
 * if we later need full Handlebars, swap the impl behind this same API.
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

  render(template: string, vars: Record<string, unknown>): string {
    const withRaw = template.replace(TemplateRenderer.RAW_PATTERN, (_m, path) => {
      const value = this.resolvePath(vars, path);
      if (value == null) {
        this.logger.debug(`template raw var missing: ${path}`);
        return '';
      }
      return String(value);
    });
    return withRaw.replace(TemplateRenderer.ESCAPED_PATTERN, (_m, path) => {
      const value = this.resolvePath(vars, path);
      if (value == null) {
        this.logger.debug(`template var missing: ${path}`);
        return '';
      }
      return TemplateRenderer.escapeHtml(String(value));
    });
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
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
}
