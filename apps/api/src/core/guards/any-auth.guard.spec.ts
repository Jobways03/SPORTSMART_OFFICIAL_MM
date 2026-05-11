import 'reflect-metadata';
import * as jwt from 'jsonwebtoken';
import { AnyAuthGuard } from './any-auth.guard';
import { UnauthorizedAppException } from '../exceptions';

/**
 * PR 4.6 — AnyAuthGuard supports all five personas (the affiliate
 * gap was the trigger) and now sets req.user.type so downstream
 * handlers can disambiguate without re-parsing the token.
 */
describe('AnyAuthGuard', () => {
  const SECRETS = {
    JWT_CUSTOMER_SECRET:  'customer-secret-must-be-at-least-32-chars-long',
    JWT_SELLER_SECRET:    'seller-secret-must-be-at-least-32-chars-long',
    JWT_FRANCHISE_SECRET: 'franchise-secret-must-be-at-least-32-chars-long',
    JWT_ADMIN_SECRET:     'admin-secret-must-be-at-least-32-chars-long',
    JWT_AFFILIATE_SECRET: 'affiliate-secret-must-be-at-least-32-chars-long',
  };

  function buildGuard() {
    const env = {
      getString: (k: keyof typeof SECRETS) => SECRETS[k],
    } as any;
    return new AnyAuthGuard(env);
  }

  function makeCtx(token: string) {
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    return {
      req,
      ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any,
    };
  }

  it.each([
    ['CUSTOMER',  SECRETS.JWT_CUSTOMER_SECRET,  ['CUSTOMER']],
    ['SELLER',    SECRETS.JWT_SELLER_SECRET,    ['SELLER']],
    ['FRANCHISE', SECRETS.JWT_FRANCHISE_SECRET, ['FRANCHISE']],
    ['ADMIN',     SECRETS.JWT_ADMIN_SECRET,     ['ADMIN']],
    ['AFFILIATE', SECRETS.JWT_AFFILIATE_SECRET, ['AFFILIATE']],
  ] as const)('accepts %s tokens and sets req.user.type', (type, secret, roles) => {
    const token = jwt.sign({ sub: 'u-1', roles }, secret);
    const { ctx, req } = makeCtx(token);
    expect(buildGuard().canActivate(ctx)).toBe(true);
    expect(req.user.type).toBe(type);
    expect(req.user.id).toBe('u-1');
    expect(req.user.roles).toEqual(roles);
    expect(req.authActorId).toBe('u-1');
  });

  it('rejects a token signed with a foreign secret', () => {
    const token = jwt.sign({ sub: 'u-1' }, 'some-other-secret-32chars-long-aaaaaaa');
    const { ctx } = makeCtx(token);
    expect(() => buildGuard().canActivate(ctx)).toThrow(UnauthorizedAppException);
  });

  it('rejects missing Authorization header', () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as any;
    expect(() => buildGuard().canActivate(ctx)).toThrow(UnauthorizedAppException);
  });
});
