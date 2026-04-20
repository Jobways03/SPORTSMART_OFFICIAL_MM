import 'reflect-metadata';
import { AnyAuthGuard } from '../../src/core/guards/any-auth.guard';
import { AiContentController } from '../../src/modules/ai/controllers/ai-content.controller';
import { UnauthorizedAppException } from '../../src/core/exceptions';

/**
 * Regression test for AI / Gemini endpoint hardening.
 *
 * Before: /api/v1/ai/generate-product-content had no auth guard and no
 * rate limit. Anyone could hit it and burn Gemini API quota at ~40
 * req/s (bounded only by the app-wide 300/60s throttler, which is
 * nowhere near tight enough for a paid-per-call upstream). Prompt
 * inputs had no length caps, so an attacker could inject instructions
 * via a huge `title` to hijack the system prompt.
 *
 * After:
 *   - @UseGuards(AnyAuthGuard) — accepts any valid actor JWT
 *   - @Throttle 10 req / 60s per caller
 *   - Input length caps on every field before interpolation into the
 *     prompt (200 / 100 / 100 / 500 chars)
 */

describe('AnyAuthGuard', () => {
  const buildGuard = (secrets: Record<string, string>) => {
    const envService: any = {
      getString: (k: string) => secrets[k] ?? '',
    };
    return new AnyAuthGuard(envService);
  };

  const buildCtx = (authHeader: string | undefined) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: authHeader } }),
      }),
    }) as any;

  it('rejects missing Authorization header', () => {
    const guard = buildGuard({ JWT_CUSTOMER_SECRET: 'x'.repeat(32) });
    expect(() => guard.canActivate(buildCtx(undefined))).toThrow(
      UnauthorizedAppException,
    );
  });

  it('rejects non-Bearer scheme', () => {
    const guard = buildGuard({ JWT_CUSTOMER_SECRET: 'x'.repeat(32) });
    expect(() => guard.canActivate(buildCtx('Basic foo'))).toThrow(
      UnauthorizedAppException,
    );
  });

  it('accepts a JWT signed with any of the four actor secrets', () => {
    const jwt = require('jsonwebtoken');
    const secret = 'a'.repeat(32);
    const token = jwt.sign({ sub: 'user-1' }, secret);
    const guard = buildGuard({
      JWT_CUSTOMER_SECRET: 'w'.repeat(32),
      JWT_SELLER_SECRET: 'x'.repeat(32),
      JWT_FRANCHISE_SECRET: 'y'.repeat(32),
      JWT_ADMIN_SECRET: secret,
    });
    expect(guard.canActivate(buildCtx(`Bearer ${token}`))).toBe(true);
  });

  it('rejects a JWT signed with an unrelated secret', () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ sub: 'user-1' }, 'z'.repeat(32));
    const guard = buildGuard({
      JWT_CUSTOMER_SECRET: 'w'.repeat(32),
      JWT_SELLER_SECRET: 'x'.repeat(32),
      JWT_FRANCHISE_SECRET: 'y'.repeat(32),
      JWT_ADMIN_SECRET: 'a'.repeat(32),
    });
    expect(() => guard.canActivate(buildCtx(`Bearer ${token}`))).toThrow(
      UnauthorizedAppException,
    );
  });
});

describe('AiContentController — decorator metadata', () => {
  it('has AnyAuthGuard wired at the controller level', () => {
    const guards = Reflect.getMetadata('__guards__', AiContentController);
    expect(Array.isArray(guards)).toBe(true);
    expect(guards.map((g: any) => g.name ?? g)).toContain('AnyAuthGuard');
  });

  it('has per-endpoint @Throttle on generateProductContent', () => {
    const target =
      AiContentController.prototype.generateProductContent as any;
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', target);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', target);
    expect({ limit, ttl }).toEqual({ limit: 10, ttl: 60_000 });
  });
});

describe('AiContentController — input length caps', () => {
  const instance = (() => {
    const ctrl = new AiContentController();
    return ctrl;
  })();

  it('rejects missing title', async () => {
    await expect(
      instance.generateProductContent({ title: '' } as any),
    ).rejects.toThrow(/title is required/i);
  });

  it('rejects title longer than 200 chars', async () => {
    await expect(
      instance.generateProductContent({ title: 'a'.repeat(201) } as any),
    ).rejects.toThrow(/200 characters/);
  });
});
