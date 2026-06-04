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

describe('AiContentController — actor gate + input length caps', () => {
  // Brought current (Phase 249): the controller takes (req, body) and is
  // DI-constructed. Mock the deps; onModuleInit is not called so the
  // optional-chained metric handles stay undefined (no-op).
  const build = () =>
    new AiContentController(
      { counter: () => ({ inc: () => {} }), histogram: () => ({ observe: () => {} }) } as any,
      { generate: jest.fn() } as any,
      { assertWithinQuota: jest.fn().mockResolvedValue(undefined), recordCall: jest.fn() } as any,
    );
  const sellerReq = { authActorId: 's1', user: { type: 'SELLER' } } as any;

  // Phase 249 (#1) — the budget gate: only SELLER/ADMIN may generate.
  it('rejects a CUSTOMER actor (budget gate) with Forbidden', async () => {
    await expect(
      build().generateProductContent(
        { authActorId: 'c1', user: { type: 'CUSTOMER' } } as any,
        { title: 'Tennis Racket' } as any,
      ),
    ).rejects.toThrow(/Not allowed to use AI/i);
  });

  it('rejects an AFFILIATE actor (budget gate) with Forbidden', async () => {
    await expect(
      build().generateProductContent(
        { authActorId: 'a1', user: { type: 'AFFILIATE' } } as any,
        { title: 'Tennis Racket' } as any,
      ),
    ).rejects.toThrow(/Not allowed to use AI/i);
  });

  it('rejects missing title (seller)', async () => {
    await expect(
      build().generateProductContent(sellerReq, { title: '' } as any),
    ).rejects.toThrow(/title is required/i);
  });

  it('rejects title longer than 200 chars (seller)', async () => {
    await expect(
      build().generateProductContent(sellerReq, { title: 'a'.repeat(201) } as any),
    ).rejects.toThrow(/200 characters/);
  });
});
