import { ArgumentsHost } from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ForbiddenAppException } from '../exceptions/forbidden.exception';
import { AppException } from '../exceptions/app.exception';

/**
 * Regression coverage for the AppException → HTTP-status mapping.
 *
 * Root cause this guards against: `mapAppExceptionToStatus` is an explicit
 * allow-list with an `|| INTERNAL_SERVER_ERROR` fallback. Any AppException
 * thrown with a NEW `code` that isn't added to the map silently surfaces as a
 * 500 — which is how the portal-isolation gates (WRONG_SELLER_PORTAL /
 * WRONG_ADMIN_PORTAL) first shipped (a 403 intent rendered as a 500). These
 * tests fail on the pre-fix filter and pass once the codes are mapped.
 */
describe('GlobalExceptionFilter — AppException status mapping', () => {
  const makeLogger = () =>
    ({
      setContext: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }) as any;

  /** Build an ArgumentsHost whose response records the status it was given. */
  const makeHost = (): { host: ArgumentsHost; statusOf: () => number } => {
    let captured = 0;
    const response = {
      status: (code: number) => {
        captured = code;
        return response;
      },
      json: () => response,
      header: () => response,
    };
    const request = { url: '/x', originalUrl: '/x' };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    return { host, statusOf: () => captured };
  };

  const statusFor = (err: unknown): number => {
    const filter = new GlobalExceptionFilter(makeLogger());
    const { host, statusOf } = makeHost();
    filter.catch(err, host);
    return statusOf();
  };

  it('maps WRONG_ADMIN_PORTAL to 403 (admin portal isolation gate)', () => {
    expect(
      statusFor(new ForbiddenAppException('wrong portal', 'WRONG_ADMIN_PORTAL')),
    ).toBe(403);
  });

  it('maps WRONG_SELLER_PORTAL to 403 (seller portal isolation gate)', () => {
    expect(
      statusFor(
        new ForbiddenAppException('wrong portal', 'WRONG_SELLER_PORTAL'),
      ),
    ).toBe(403);
  });

  it('maps ENFORCED_MFA_ENROLLMENT to 403 (mandatory-MFA login gate)', () => {
    // An un-enrolled admin is hard-blocked at login. Pre-fix this code was
    // absent from the map and fell through to 500, so the login screen showed
    // a generic "Something went wrong" instead of the "enroll MFA" message.
    expect(
      statusFor(
        new ForbiddenAppException('enroll MFA', 'ENFORCED_MFA_ENROLLMENT'),
      ),
    ).toBe(403);
  });

  it('maps MAKE_LIVE_SUPER_ADMIN_ONLY to 403 (super-admin-only make-live gate)', () => {
    expect(
      statusFor(
        new ForbiddenAppException('super only', 'MAKE_LIVE_SUPER_ADMIN_ONLY'),
      ),
    ).toBe(403);
  });

  it('still maps the generic FORBIDDEN code to 403', () => {
    expect(statusFor(new ForbiddenAppException('nope'))).toBe(403);
  });

  it('falls back to 500 for a genuinely unknown app code (documents the trap)', () => {
    expect(statusFor(new AppException('mystery', 'SOME_UNMAPPED_CODE'))).toBe(
      500,
    );
  });
});
