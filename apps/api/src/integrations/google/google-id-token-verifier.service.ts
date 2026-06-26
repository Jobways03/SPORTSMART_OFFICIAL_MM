import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppLoggerService } from '../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../bootstrap/env/env.service';
import {
  BadRequestAppException,
  UnauthorizedAppException,
} from '../../core/exceptions';

/**
 * The verified identity claims we lift out of a Google ID token. Only
 * the fields the login flow needs — never the raw token, never the
 * full Google profile.
 */
export interface GoogleIdentity {
  /** Google's stable subject id (`sub`). The match key for AuthIdentity. */
  sub: string;
  /** Lower-cased email Google asserts. Empty string if Google omitted it. */
  email: string;
  /** Whether Google asserted the email as verified (`email_verified`). */
  emailVerified: boolean;
  /** Given name (`given_name`); '' when Google omits it. */
  firstName: string;
  /** Family name (`family_name`); '' when Google omits it. */
  lastName: string;
}

/**
 * "Sign in with Google" — server-side ID-token verification.
 *
 * Mirrors CaptchaVerifierService in shape: a thin integration verifier
 * that reads its single piece of config (GOOGLE_CLIENT_ID) once at
 * construction via EnvService, and converts every failure mode into a
 * narrow, uniform app exception so the caller never has to reason about
 * the upstream library's error surface.
 *
 * GOOGLE_CLIENT_ID is BOTH the OAuth2 client id we construct the
 * verifier with AND the `audience` we pin the verify against — a token
 * minted for a different client (different app, phishing site) fails
 * the audience check and is rejected. The library also validates the
 * `iss`, signature, and expiry against Google's published JWKS.
 *
 * Failure mapping:
 *   • GOOGLE_CLIENT_ID unset  → BadRequestAppException (400) "Google
 *     login is not configured" — the feature is off, fail loud + clear
 *     rather than silently accept-by-default.
 *   • missing / invalid / expired / wrong-audience / wrong-issuer token
 *     → UnauthorizedAppException (401) "Google sign-in failed."
 *
 * The raw credential is NEVER logged.
 */
@Injectable()
export class GoogleIdTokenVerifierService {
  private readonly clientId: string | undefined;
  /** Lazily constructed so an unconfigured deploy pays no cost. */
  private client: OAuth2Client | null = null;

  constructor(
    private readonly logger: AppLoggerService,
    private readonly env: EnvService,
  ) {
    this.logger.setContext('GoogleIdTokenVerifierService');
    this.clientId = this.env.getOptional('GOOGLE_CLIENT_ID');
    if (!this.clientId) {
      this.logger.warn(
        'GOOGLE_CLIENT_ID is unset — "Sign in with Google" is disabled. ' +
          'Set GOOGLE_CLIENT_ID to the public OAuth client id to enable it.',
      );
    }
  }

  /** True when the feature is configured. Lets callers/tests gate cheaply. */
  isConfigured(): boolean {
    return !!this.clientId;
  }

  /**
   * Verify a Google ID token (the `credential` the GIS button returns)
   * and return the trimmed identity claims. Throws on any failure —
   * never returns a partially-trusted result.
   */
  async verify(idToken: string | undefined): Promise<GoogleIdentity> {
    if (!this.clientId) {
      // Feature not configured. Fail closed with a clear, distinct
      // message so an operator sees "set GOOGLE_CLIENT_ID" rather than
      // a generic auth error.
      throw new BadRequestAppException(
        'Google login is not configured',
        'BAD_REQUEST',
      );
    }

    if (!idToken || idToken.trim().length === 0) {
      throw new UnauthorizedAppException(
        'Google sign-in failed. Missing credential.',
      );
    }

    if (!this.client) {
      this.client = new OAuth2Client(this.clientId);
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        throw new UnauthorizedAppException(
          'Google sign-in failed. Please try again.',
        );
      }
      return {
        sub: payload.sub,
        email: (payload.email ?? '').trim().toLowerCase(),
        emailVerified: payload.email_verified === true,
        firstName: (payload.given_name ?? '').trim(),
        lastName: (payload.family_name ?? '').trim(),
      };
    } catch (err) {
      if (
        err instanceof UnauthorizedAppException ||
        err instanceof BadRequestAppException
      ) {
        throw err;
      }
      // Invalid signature / expired / wrong audience / wrong issuer /
      // network error fetching Google's keys all land here. Log the
      // library's reason (which never contains the raw token) and
      // collapse to a uniform 401.
      this.logger.warn(
        `Google ID token verification rejected: ${(err as Error)?.message ?? 'unknown'}`,
      );
      throw new UnauthorizedAppException(
        'Google sign-in failed. Please try again.',
      );
    }
  }
}
