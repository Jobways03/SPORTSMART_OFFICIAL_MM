import { Injectable, Logger } from '@nestjs/common';

/**
 * Minimal Handlebars-style renderer. Replaces `{{varName}}` (and dotted
 * paths like `{{user.firstName}}`) in a string with values from a
 * variables object. No conditionals / helpers / loops — keep it small;
 * if we later need full Handlebars, swap the impl behind this same API.
 *
 * Missing variables render as empty strings + log a warning so editors
 * can spot template/payload drift.
 */
@Injectable()
export class TemplateRenderer {
  private readonly logger = new Logger(TemplateRenderer.name);

  render(template: string, vars: Record<string, unknown>): string {
    return template.replace(/{{\s*([\w.]+)\s*}}/g, (_match, path) => {
      const value = this.resolvePath(vars, path);
      if (value == null) {
        this.logger.debug(`template var missing: ${path}`);
        return '';
      }
      return String(value);
    });
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
  }
}
