export const SESSION_REPOSITORY = Symbol('SessionRepository');

export interface SessionRecord {
  id: string;
  userId: string;
  refreshToken: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface SessionRepository {
  findById(id: string): Promise<SessionRecord | null>;
  findByUserId(userId: string): Promise<SessionRecord[]>;
  save(session: unknown): Promise<void>;
  revoke(sessionId: string): Promise<void>;

  createSession(data: {
    userId: string;
    refreshToken: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord>;

  revokeAllUserSessions(userId: string): Promise<void>;
}
