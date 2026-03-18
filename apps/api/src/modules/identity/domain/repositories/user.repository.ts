export interface UserRepository {
  findById(id: string): Promise<unknown | null>;
  findByEmail(email: string): Promise<unknown | null>;
  save(user: unknown): Promise<void>;
}
