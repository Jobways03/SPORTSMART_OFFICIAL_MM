import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import { NotFoundAppException } from '../exceptions';

/**
 * Phase 10 (PR 10.1) — Public API key service.
 *
 * Issuance:
 *   - Plaintext key format: `sk_<env>_<32 random base64url chars>`.
 *     Env: "live" or "test". The prefix is the first 8 chars and is
 *     persisted alongside the hash so admins can identify keys
 *     without seeing the plaintext.
 *   - Plaintext is returned ONCE from `mint()`. The caller (admin
 *     UI) shows it to the user and stores it nowhere else.
 *
 * Verification:
 *   - Hash the presented bearer with SHA-256, look up by hash, and
 *     constant-time compare against the stored hash. The unique
 *     index on key_hash makes this O(1).
 *
 * Revocation:
 *   - `revoke()` flips status + stamps revokedAt. Verifier rejects
 *     REVOKED keys immediately.
 */

export interface MintInput {
  name: string;
  description?: string;
  environment: 'LIVE' | 'TEST';
  scopes?: string[];
  sellerId?: string;
  affiliateId?: string;
  rateLimitPerMinute?: number;
}

export interface MintResult {
  /** Returned once. Caller is responsible for showing this to the user. */
  plaintextKey: string;
  /** Persisted record (without the hash for safety). */
  keyId: string;
  keyPrefix: string;
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async mint(input: MintInput): Promise<MintResult> {
    const envTag = input.environment === 'LIVE' ? 'live' : 'test';
    const random = randomBytes(24).toString('base64url'); // 32 chars
    const plaintext = `sk_${envTag}_${random}`;
    const keyPrefix = plaintext.slice(0, 12);
    const keyHash = sha256Hex(plaintext);

    const row = await this.prisma.apiKey.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        keyPrefix,
        keyHash,
        scopes: input.scopes ?? [],
        environment: input.environment,
        sellerId: input.sellerId ?? null,
        affiliateId: input.affiliateId ?? null,
        rateLimitPerMinute: input.rateLimitPerMinute ?? null,
      },
      select: { id: true, keyPrefix: true },
    });

    return {
      plaintextKey: plaintext,
      keyId: row.id,
      keyPrefix: row.keyPrefix,
    };
  }

  /**
   * Verify a presented bearer token. Returns the API key row when
   * valid, null otherwise. Stamps `lastUsedAt` opportunistically —
   * we don't await the update so the verify path stays fast.
   */
  async verify(plaintext: string): Promise<{
    id: string;
    scopes: string[];
    environment: 'LIVE' | 'TEST';
    sellerId: string | null;
    affiliateId: string | null;
    rateLimitPerMinute: number | null;
  } | null> {
    if (!plaintext || !plaintext.startsWith('sk_')) return null;
    const keyHash = sha256Hex(plaintext);
    const row = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        keyHash: true,
        scopes: true,
        environment: true,
        status: true,
        sellerId: true,
        affiliateId: true,
        rateLimitPerMinute: true,
      },
    });
    if (!row) return null;
    if (row.status !== 'ACTIVE') return null;
    // Constant-time defence-in-depth — the unique-index lookup already
    // matched on hash, but if the user crafts collisions in some
    // future hash refactor, the equal check shouldn't leak timing.
    if (!constantTimeEq(row.keyHash, keyHash)) return null;

    // Fire-and-forget last-used stamp (1s slop is fine).
    this.prisma.apiKey
      .update({
        where: { id: row.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to stamp lastUsedAt on key ${row.id}: ${(err as Error).message}`,
        ),
      );

    return {
      id: row.id,
      scopes: row.scopes,
      environment: row.environment,
      sellerId: row.sellerId,
      affiliateId: row.affiliateId,
      rateLimitPerMinute: row.rateLimitPerMinute,
    };
  }

  async revoke(id: string, revokedBy: string): Promise<void> {
    const row = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!row) throw new NotFoundAppException('API key not found');
    if (row.status === 'REVOKED') return;
    await this.prisma.apiKey.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedBy,
      },
    });
  }

  /** Append a usage row. Best-effort (errors swallowed). */
  async recordUsage(input: {
    keyId: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    ipPrefix?: string | null;
  }): Promise<void> {
    try {
      await this.prisma.apiKeyUsage.create({
        data: {
          keyId: input.keyId,
          method: input.method,
          path: input.path,
          status: input.status,
          durationMs: input.durationMs,
          ipPrefix: input.ipPrefix ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record api-key usage: ${(err as Error).message}`,
      );
    }
  }
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
