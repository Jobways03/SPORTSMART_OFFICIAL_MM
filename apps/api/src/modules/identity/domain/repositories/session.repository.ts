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
  revoke(sessionId: string): Promise<void>;

  createSession(data: {
    userId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord>;

  /**
   * Atomically rotate the refresh token for a session and extend its expiry.
   * Used by the refresh-session flow to issue a fresh refresh token while
   * keeping the same session row (so revocation still works).
   */
  rotateRefreshToken(
    sessionId: string,
    newRefreshToken: string,
    newExpiresAt: Date,
  ): Promise<SessionRecord>;

  revokeAllUserSessions(userId: string): Promise<void>;
}
