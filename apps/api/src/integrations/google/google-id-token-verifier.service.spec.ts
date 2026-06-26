import { GoogleIdTokenVerifierService } from './google-id-token-verifier.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../core/exceptions';

/**
 * "Sign in with Google" — server-side ID-token verifier.
 *
 * Security-critical surface: this is the ONLY thing standing between a
 * caller-supplied `credential` string and a trusted set of identity
 * claims. These tests pin the four behaviours that matter:
 *   (a) feature-off → loud BadRequest (never silently accept-by-default);
 *   (b) a verified payload is trimmed to exactly the claims we trust;
 *   (c) emailVerified is HARD false unless Google asserts `=== true`;
 *   (d) any library rejection (bad sig / expired / wrong audience /
 *       missing sub / empty token) collapses to a uniform 401.
 *
 * google-auth-library's OAuth2Client is mocked so nothing touches the
 * network or Google's JWKS. The mock factory references `mockVerifyIdToken`
 * (the `mock` prefix is the jest-hoisting escape hatch).
 */
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const noopLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

/** EnvService stub: returns the supplied GOOGLE_CLIENT_ID (or undefined). */
function buildEnv(clientId: string | undefined) {
  return {
    getOptional: (key: string) =>
      key === 'GOOGLE_CLIENT_ID' ? clientId : undefined,
  } as any;
}

const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';

/** Build a ticket whose getPayload() returns the given payload. */
function ticketWith(payload: unknown) {
  return { getPayload: () => payload } as any;
}

beforeEach(() => {
  mockVerifyIdToken.mockReset();
});

describe('GoogleIdTokenVerifierService', () => {
  describe('(a) feature not configured', () => {
    it('throws BadRequest "not configured" when GOOGLE_CLIENT_ID is unset — and never calls the library', async () => {
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(undefined),
      );

      expect(svc.isConfigured()).toBe(false);

      await expect(svc.verify('any-token')).rejects.toBeInstanceOf(
        BadRequestAppException,
      );
      await expect(svc.verify('any-token')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Google login is not configured',
      });
      // Fail-closed before any token verification is attempted.
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });

  describe('(b) verified payload → trimmed identity claims', () => {
    it('maps a fully-populated verified payload to { sub, email(lower/trim), emailVerified:true, firstName, lastName }', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({
          sub: 'google-sub-123',
          email: '  Alice@Example.COM ',
          email_verified: true,
          given_name: ' Alice ',
          family_name: ' Smith ',
        }),
      );

      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );
      expect(svc.isConfigured()).toBe(true);

      const identity = await svc.verify('good-token');

      expect(identity).toEqual({
        sub: 'google-sub-123',
        email: 'alice@example.com',
        emailVerified: true,
        firstName: 'Alice',
        lastName: 'Smith',
      });
      // Audience is pinned to the configured client id (anti-phishing).
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: 'good-token',
        audience: CLIENT_ID,
      });
    });

    it('tolerates a verified payload that omits optional name/email fields (empty strings, not undefined)', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({ sub: 'google-sub-456', email_verified: true }),
      );

      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );

      const identity = await svc.verify('good-token');
      expect(identity).toEqual({
        sub: 'google-sub-456',
        email: '',
        emailVerified: true,
        firstName: '',
        lastName: '',
      });
    });
  });

  describe('(c) emailVerified is false unless Google asserts === true', () => {
    it('email_verified === false → emailVerified false', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({
          sub: 's',
          email: 'bob@example.com',
          email_verified: false,
        }),
      );
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );
      const identity = await svc.verify('t');
      expect(identity.emailVerified).toBe(false);
    });

    it('email_verified omitted (undefined) → emailVerified false (default-deny)', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({ sub: 's', email: 'bob@example.com' }),
      );
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );
      const identity = await svc.verify('t');
      expect(identity.emailVerified).toBe(false);
    });

    it('email_verified is the string "true" (not boolean) → emailVerified false (strict ===)', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({
          sub: 's',
          email: 'bob@example.com',
          email_verified: 'true',
        }),
      );
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );
      const identity = await svc.verify('t');
      expect(identity.emailVerified).toBe(false);
    });
  });

  describe('(d) rejection paths → uniform 401', () => {
    it('library throws (invalid signature / expired / wrong audience) → UnauthorizedAppException', async () => {
      mockVerifyIdToken.mockRejectedValue(
        new Error('Token used too late, 1700000000 > 1699999999'),
      );
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );

      await expect(svc.verify('expired-token')).rejects.toBeInstanceOf(
        UnauthorizedAppException,
      );
      await expect(svc.verify('expired-token')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Google sign-in failed. Please try again.',
      });
    });

    it('wrong-audience rejection collapses to the SAME uniform 401 (no detail leaked)', async () => {
      mockVerifyIdToken.mockRejectedValue(
        new Error('Wrong recipient, payload audience != requiredAudience'),
      );
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );
      await expect(svc.verify('foreign-token')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Google sign-in failed. Please try again.',
      });
    });

    it('verified ticket with NO payload → 401', async () => {
      mockVerifyIdToken.mockResolvedValue(ticketWith(null));
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );
      await expect(svc.verify('t')).rejects.toBeInstanceOf(
        UnauthorizedAppException,
      );
    });

    it('payload missing `sub` → 401 (never trust a subject-less token)', async () => {
      mockVerifyIdToken.mockResolvedValue(
        ticketWith({ email: 'x@example.com', email_verified: true }),
      );
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );
      await expect(svc.verify('t')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('empty / whitespace / undefined credential → 401 BEFORE any verify call', async () => {
      const svc = new GoogleIdTokenVerifierService(
        noopLogger,
        buildEnv(CLIENT_ID),
      );

      await expect(svc.verify(undefined)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Google sign-in failed. Missing credential.',
      });
      await expect(svc.verify('   ')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });
});
