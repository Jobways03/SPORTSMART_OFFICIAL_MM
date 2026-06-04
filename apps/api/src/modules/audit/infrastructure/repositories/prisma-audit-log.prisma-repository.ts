import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditLogRepositoryPort } from '../../domain/repositories/audit-log.repository';
import { redactSecrets } from '../../application/services/audit-redaction.util';
import {
  AUDIT_HASH_SCHEMA_VERSION,
  canonicalAuditPayloadV2,
  computeAuditHash,
} from '../../application/services/audit-hash.util';

const CHAIN_TIP_ID = 'singleton';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append one hash-chained audit row.
   *
   * Phase 203 fixes:
   *   #1  ONE timestamp generated here is written into BOTH the row's
   *       created_at AND the hash payload's `ts`, so the content hash is
   *       exactly recomputable (schemaVersion=2).
   *   #2  The previous hash is read from the single-row `audit_chain_tip`
   *       under `SELECT … FOR UPDATE`, serializing concurrent writers — two
   *       transactions can no longer read the same prevHash and fork the chain.
   *   #4  Optional `tx` lets a caller append the audit row inside their own
   *       business transaction (atomic with the change being audited).
   *   #10 oldValue / newValue / metadata are scrubbed of secrets before write.
   */
  async save(
    entry: Parameters<AuditLogRepositoryPort['save']>[0],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (tx) {
      await this.append(tx, entry);
      return;
    }
    await this.prisma.$transaction((t) => this.append(t, entry));
  }

  private async append(
    tx: Prisma.TransactionClient,
    entry: Parameters<AuditLogRepositoryPort['save']>[0],
  ): Promise<void> {
    // #2 — lock the single chain-tip row FOR UPDATE. The second concurrent
    // writer blocks here until the first commits, then reads its hash. Ensure
    // the row exists (it is seeded by the migration; this is belt-and-braces
    // for a fresh DB before the migration's INSERT ran).
    await tx.$executeRaw`
      INSERT INTO "audit_chain_tip" ("id", "updated_at")
      VALUES (${CHAIN_TIP_ID}, now())
      ON CONFLICT ("id") DO NOTHING
    `;
    const tip = await tx.$queryRaw<Array<{ last_hash: string | null }>>`
      SELECT "last_hash" FROM "audit_chain_tip" WHERE "id" = ${CHAIN_TIP_ID} FOR UPDATE
    `;
    const prevHash = tip[0]?.last_hash ?? null;

    // #10 — redact secrets out of the arbitrary JSON before it is hashed AND
    // persisted (so the hash matches what's stored).
    const oldValue = redactSecrets(entry.oldValue ?? null);
    const newValue = redactSecrets(entry.newValue ?? null);
    const metadata = redactSecrets(entry.metadata ?? null);

    // #1 — single source of truth for the timestamp.
    const createdAt = new Date();
    const actorType = entry.actorType ?? null;
    const requestId = entry.requestId ?? null;

    const payload = canonicalAuditPayloadV2({
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      actorType,
      action: entry.action,
      module: entry.module,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      oldValue,
      newValue,
      metadata,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      requestId,
      createdAt,
    });
    const hash = computeAuditHash(prevHash, payload);

    const created = await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        actorRole: entry.actorRole,
        actorType: actorType as any,
        action: entry.action,
        module: entry.module,
        resource: entry.resource,
        resourceId: entry.resourceId,
        oldValue: oldValue as any,
        newValue: newValue as any,
        metadata: metadata as any,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        requestId,
        prevHash,
        hash,
        schemaVersion: AUDIT_HASH_SCHEMA_VERSION,
        // #1 — write the SAME timestamp the hash was built from.
        createdAt,
      },
      select: { sequenceNumber: true },
    });

    // Advance the tip to this row. Still under the FOR UPDATE lock.
    await tx.$executeRaw`
      UPDATE "audit_chain_tip"
      SET "last_hash" = ${hash}, "last_sequence" = ${created.sequenceNumber}, "updated_at" = now()
      WHERE "id" = ${CHAIN_TIP_ID}
    `;
  }

  async findByFilters(
    filters: Parameters<AuditLogRepositoryPort['findByFilters']>[0],
  ): Promise<unknown[]> {
    return this.prisma.auditLog.findMany({
      where: {
        ...(filters.module && { module: filters.module }),
        ...(filters.resource && { resource: filters.resource }),
        ...(filters.resourceId && { resourceId: filters.resourceId }),
        ...(filters.actorId && { actorId: filters.actorId }),
        ...((filters.from || filters.to) && {
          createdAt: {
            ...(filters.from && { gte: filters.from }),
            ...(filters.to && { lte: filters.to }),
          },
        }),
      },
      take: filters.limit || 50,
      skip: filters.offset || 0,
      // #11 — deterministic newest-first ordering by the monotonic sequence,
      // not createdAt (which can tie at ms resolution).
      orderBy: { sequenceNumber: 'desc' },
    });
  }
}
