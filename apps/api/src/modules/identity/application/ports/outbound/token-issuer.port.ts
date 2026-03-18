export interface TokenIssuerPort {
  issueAccessToken(payload: Record<string, unknown>): string;
  issueRefreshToken(payload: Record<string, unknown>): string;
  verifyToken(token: string): Record<string, unknown>;
}
