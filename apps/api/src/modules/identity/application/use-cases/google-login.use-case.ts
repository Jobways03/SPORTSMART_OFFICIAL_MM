import { Inject, Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { UnauthorizedAppException } from '../../../../core/exceptions';
import { GoogleIdTokenVerifierService } from '../../../../integrations/google/google-id-token-verifier.service';
import { LoginResponseData } from '../../presentation/dtos/auth-response.dto';
import { LoginUserUseCase } from './login-user.use-case';
import { ConsentService } from '../services/consent.service';
import {
  UserRepository,
  USER_REPOSITORY,
  RegistrationConsentInput,
} from '../../domain/repositories/user.repository';

interface GoogleLoginInput {
  /** The Google ID token (the `credential` the GIS button returns). */
  credential: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * "Sign in with Google" — customer login/registration via a verified
 * Google ID token.
 *
 * Pipeline:
 *   1. Verify the credential (signature, expiry, audience) and lift the
 *      identity claims. A failed verify throws (handled by the verifier).
 *   2. Reject if Google did not assert the email as verified — we only
 *      ever link/create on a provider-verified email.
 *   3. Resolve to a User in three steps (first hit wins):
 *      a. AuthIdentity(provider='google', sub) → returning Google user.
 *      b. User with the same verified email → AUTO-LINK (insert the
 *         AuthIdentity row + activate) and sign in.
 *      c. Otherwise → AUTO-CREATE a new customer (ACTIVE + emailVerified,
 *         no password, CUSTOMER role, AuthIdentity, consent rows) in one
 *         transaction.
 *   4. Issue an identical customer session via LoginUserUseCase
 *      .issueCustomerSession (same JWT/claims/TTLs as password login —
 *      the JWT roles claim includes CUSTOMER).
 *
 * Decisions baked in: auto-link on verified-email match; auto-create as
 * ACTIVE + emailVerified; phone is NOT required (collected later).
 *
 * Moderated accounts (SUSPENDED / BANNED / INACTIVE) are refused with the
 * uniform 401 — Google proving email ownership does not override a ban,
 * and we never leak the moderation state.
 */
@Injectable()
export class GoogleLoginUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: UserRepository,
    private readonly googleVerifier: GoogleIdTokenVerifierService,
    // Reuse the password-login session-mint tail so the OAuth path issues
    // a byte-identical session (same JWT secret, audience, claims, TTLs,
    // event). No DI cycle: LoginUserUseCase does not depend on this class.
    private readonly loginUseCase: LoginUserUseCase,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('GoogleLoginUseCase');
  }

  async execute(input: GoogleLoginInput): Promise<LoginResponseData> {
    const { credential, userAgent, ipAddress } = input;

    const identity = await this.googleVerifier.verify(credential);

    // We only ever link/create from a provider-verified email. An
    // unverified Google email could be attacker-controlled (Google lets
    // you add an unverified email to an account), so auto-linking it to a
    // matching local account would be an account-takeover vector.
    if (!identity.emailVerified) {
      throw new UnauthorizedAppException(
        'Your Google account email is not verified. Use a verified Google account or sign in with email and password.',
      );
    }
    if (!identity.email) {
      // Defensive: a verified token without an email claim can't be
      // matched or used to create an account.
      throw new UnauthorizedAppException(
        'Google sign-in failed. Please try again.',
      );
    }

    const context = { userAgent, ipAddress };

    // 3a) Returning Google user — match the provider link.
    const linked = await this.userRepo.findUserByAuthIdentity(
      'google',
      identity.sub,
    );
    if (linked) {
      this.assertNotModerated(linked);
      return this.loginUseCase.issueCustomerSession(linked, context);
    }

    // 3b) Existing account with the same (Google-verified) email →
    // AUTO-LINK and sign in.
    const byEmail = await this.userRepo.findByEmailWithRoles(identity.email);
    if (byEmail) {
      this.assertNotModerated(byEmail);
      const relinked = await this.userRepo.linkGoogleIdentityAndActivate({
        userId: byEmail.id,
        providerSubject: identity.sub,
        providerEmail: identity.email,
      });
      this.logger.log(
        `Google identity auto-linked to existing user ${byEmail.id}`,
      );
      return this.loginUseCase.issueCustomerSession(relinked, context);
    }

    // 3c) Brand-new customer — AUTO-CREATE.
    const consents = this.buildConsents(ipAddress, userAgent);
    let created = await this.userRepo.createGoogleCustomer({
      // Google may omit name parts; fall back so NOT NULL columns are
      // satisfied. The customer can edit these later in their profile.
      firstName: identity.firstName || 'Customer',
      lastName: identity.lastName || '',
      email: identity.email,
      providerSubject: identity.sub,
      providerEmail: identity.email,
      consents,
    });

    if (!created) {
      // P2002 race: a concurrent Google login created the same email or
      // linked the same subject first. Recover by re-querying — prefer
      // the identity link, fall back to the email match.
      created =
        (await this.userRepo.findUserByAuthIdentity('google', identity.sub)) ??
        (await this.userRepo.findByEmailWithRoles(identity.email));
      if (!created) {
        throw new UnauthorizedAppException(
          'Google sign-in failed. Please try again.',
        );
      }
      this.assertNotModerated(created);
    } else {
      this.logger.log(`New Google customer created ${created.id}`);
    }

    return this.loginUseCase.issueCustomerSession(created, context);
  }

  /**
   * Refuse a moderated account with the uniform 401 — same posture as the
   * password-login state gate. ACTIVE and PENDING_VERIFICATION proceed
   * (the latter is activated in the auto-link transaction).
   */
  private assertNotModerated(user: { status: string }): void {
    if (
      user.status === 'SUSPENDED' ||
      user.status === 'BANNED' ||
      user.status === 'INACTIVE'
    ) {
      throw new UnauthorizedAppException(
        'Your account cannot be signed in at this time.',
      );
    }
  }

  /**
   * Same consent purposes/version the register flow writes, tagged with
   * source 'google-oauth'. Terms + Privacy granted (shown beside the
   * Google button); marketing defaults to opt-OUT (explicit false row is
   * better than no row for the marketing-eligibility projection).
   */
  private buildConsents(
    ipAddress?: string,
    userAgent?: string,
  ): RegistrationConsentInput[] {
    const consentVersion = ConsentService.CURRENT_POLICY_VERSION;
    return [
      {
        purpose: 'TERMS_OF_SERVICE',
        granted: true,
        consentVersion,
        ipAddress,
        userAgent,
        source: 'google-oauth',
      },
      {
        purpose: 'PRIVACY_POLICY',
        granted: true,
        consentVersion,
        ipAddress,
        userAgent,
        source: 'google-oauth',
      },
      {
        purpose: 'EMAIL_MARKETING',
        granted: false,
        consentVersion,
        ipAddress,
        userAgent,
        source: 'google-oauth',
      },
    ];
  }
}
