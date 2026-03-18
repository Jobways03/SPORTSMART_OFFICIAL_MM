export interface SessionRepository {
  findById(id: string): Promise<unknown | null>;
  findByUserId(userId: string): Promise<unknown[]>;
  save(session: unknown): Promise<void>;
  revoke(sessionId: string): Promise<void>;
}
