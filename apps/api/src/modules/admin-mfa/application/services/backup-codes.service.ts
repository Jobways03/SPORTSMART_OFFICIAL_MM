import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import {
  ADMIN_REPOSITORY,
  AdminRepository,
} from '../../../admin/domain/repositories/admin.repository.interface';
import {
  generateBackupCodes,
  normaliseBackupCode,
} from '../../domain/backup-codes';

const BCRYPT_ROUNDS = 12;

/**
 * Phase 10 (PR 10.9) — Backup code lifecycle.
 *
 * Three operations:
 *
 *   1. `generateAndHashForAdmin(adminId)` — produces 10 fresh codes,
 *      bcrypt-hashes each, persists the hash array to
 *      `mfaBackupCodesHashes`, returns the cleartext codes ONCE
 *      to the caller (the frontend shows them to the admin with
 *      a "save these now" warning).
 *
 *   2. `consume(adminId, candidate)` — bcrypt-compares against the
 *      stored hash list, finds the matching hash, splices it out,
 *      persists the remaining array. Returns true on success, false
 *      otherwise. Atomicity caveat: the read-modify-write isn't
 *      transactionally locked, so two concurrent verifies presenting
 *      the same code could both succeed (the narrow window between
 *      `findAdminById` and `updateAdmin`). Realistic only as an
 *      attack scenario; the legitimate path is a single interactive
 *      request. A future PR can tighten with a Prisma `$transaction`
 *      + SELECT FOR UPDATE if needed.
 *
 *   3. `remainingCount(adminId)` — exposed for an /admin/mfa/status
 *      endpoint in a future PR ("you have N backup codes left").
 *
 * bcrypt rounds: 12 — the same cost factor the codebase uses for
 * admin passwords (see DUMMY_HASH in admin-login.use-case.ts). The
 * 10x cost-amplifier for "check each of 10 hashes" is real (~1s
 * per verify on modern hardware) but acceptable for the rare
 * backup-code path.
 */
@Injectable()
export class BackupCodesService {
  constructor(
    @Inject(ADMIN_REPOSITORY)
    private readonly adminRepo: AdminRepository,
  ) {}

  /**
   * Generate, hash, persist, and return cleartext codes. The
   * return value is the ONLY moment those cleartext values exist;
   * the caller MUST surface them to the admin and never log them.
   */
  async generateAndHashForAdmin(adminId: string): Promise<string[]> {
    const codes = generateBackupCodes();
    const hashes = await Promise.all(
      codes.map((c) => bcrypt.hash(normaliseBackupCode(c), BCRYPT_ROUNDS)),
    );
    await this.adminRepo.updateAdmin(adminId, {
      mfaBackupCodesHashes: hashes,
    });
    return codes;
  }

  /**
   * Attempt to consume `candidate` against the admin's stored
   * backup-code hashes. Returns true if the code matched (and was
   * removed from the stored list); false if no match.
   *
   * Sequential bcrypt.compare against each hash because that's
   * the only correct check — there's no way to derive the hash
   * from the cleartext without running bcrypt. Worst case is
   * O(10 × bcrypt-cost) per failed verify, which is the intended
   * brute-force resistance.
   */
  async consume(adminId: string, candidate: string): Promise<boolean> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      mfaBackupCodesHashes: true,
    });
    if (!admin) return false;
    const hashes = (admin.mfaBackupCodesHashes as string[] | null) ?? [];
    if (hashes.length === 0) return false;

    const normalised = normaliseBackupCode(candidate);
    let matchIdx = -1;
    for (let i = 0; i < hashes.length; i++) {
      // bcrypt.compare is constant-time per RFC, so a timing-leak
      // across "which hash matched" is the only side channel —
      // and that leak is only "code N is the one you got right",
      // which doesn't help an attacker who doesn't already have
      // a code. Acceptable.
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(normalised, hashes[i]!)) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx === -1) return false;

    const remaining = [...hashes.slice(0, matchIdx), ...hashes.slice(matchIdx + 1)];
    await this.adminRepo.updateAdmin(adminId, {
      mfaBackupCodesHashes: remaining,
    });
    return true;
  }

  async remainingCount(adminId: string): Promise<number> {
    const admin = await this.adminRepo.findAdminById(adminId, {
      mfaBackupCodesHashes: true,
    });
    if (!admin) return 0;
    const hashes = (admin.mfaBackupCodesHashes as string[] | null) ?? [];
    return hashes.length;
  }
}
