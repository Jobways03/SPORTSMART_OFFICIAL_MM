export const SESSION_REPOSITORY = Symbol('SessionRepository');

export interface SessionRecord {
  id: string;
  userId: string;
  refreshToken: string;
  /** Phase 3 (PR 3.6) — last-rotation slot for theft detection. */
  previousRefreshTokenHash?: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  /**
   * Phase 17 (2026-05-20) — bumps on each rotate. Drives the
   * inactive-session sweep + the /account/sessions UI.
   */
  lastUsedAt?: Date | null;
  /** Phase 17 (2026-05-20) — operator-friendly device label. */
  deviceLabel?: string | null;
  /** Phase 17 (2026-05-20) — exposed so the absolute-lifetime cap on
   * refresh can compute (now - createdAt) > cap. */
  createdAt?: Date;
}

export interface SessionRepository {
  findById(id: string): Promise<SessionRecord | null>;
  findByUserId(userId: string): Promise<SessionRecord[]>;
  findByRefreshToken(refreshToken: string): Promise<SessionRecord | null>;
  /**
   * Phase 3 (PR 3.6) — secondary lookup against the previous-rotation
   * hash. A hit here, combined with a miss on `findByRefreshToken`,
   * means a now-burned refresh token is being replayed — the
   * use-case responds by revoking every session for the user.
   */
  findByPreviousRefreshToken(refreshToken: string): Promise<SessionRecord | null>;
  save(session: unknown): Promise<void>;
  /**
   * Revoke a single session by id. Used by the default logout path
   * (per-device sign-out) — distinct from `revokeAllUserSessions`
   * which is the "sign out everywhere" admin path.
   */
  revoke(sessionId: string): Promise<void>;

  createSession(data: {
    userId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
    /** Phase 17 (2026-05-20) — operator-friendly device label
     * derived from the userAgent string. Optional. */
    deviceLabel?: string | null;
  }): Promise<SessionRecord>;

  /**
   * Atomically rotate the refresh token for a session and extend its expiry.
   * Used by the refresh-session flow to issue a fresh refresh token while
   * keeping the same session row (so revocation still works).
   *
   * Phase 17 (2026-05-20) — also writes lastUsedAt so the
   * inactive-session sweep can distinguish "actively used" from
   * "issued long ago but never touched."
   */
  rotateRefreshToken(
    sessionId: string,
    newRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<SessionRecord>;

  revokeAllUserSessions(userId: string): Promise<void>;
}
