import type {
  Wallet,
  WalletTransaction,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';

export const WALLET_REPOSITORY = Symbol('WALLET_REPOSITORY');

export interface WalletWithLatest extends Wallet {
  transactions: WalletTransaction[];
}

export interface CreateTransactionInput {
  walletId: string;
  userId: string;
  type: WalletTransactionType;
  status?: WalletTransactionStatus;
  amountInPaise: number; // signed: credits +, debits −
  balanceAfterInPaise: number;
  referenceType?: string | null;
  referenceId?: string | null;
  description: string;
  internalNotes?: string | null;
  createdByAdminId?: string | null;
}

export interface ApplyMutationResult {
  wallet: Wallet;
  transaction: WalletTransaction;
}

export interface ListWalletsFilter {
  page: number;
  limit: number;
  search?: string;
  /** Min wallet balance in paise (inclusive). */
  minBalanceInPaise?: number;
  /** Max wallet balance in paise (inclusive). */
  maxBalanceInPaise?: number;
  /** Filter to only blocked or only unblocked wallets. */
  blocked?: boolean;
}

export interface ListWalletsItem {
  walletId: string;
  userId: string;
  userEmail: string;
  userFullName: string;
  balanceInPaise: number;
  currency: string;
  updatedAt: Date;
}

export interface ListWalletsPage {
  items: ListWalletsItem[];
  page: number;
  limit: number;
  total: number;
}

export interface WalletRepository {
  /** Lazy: returns existing or creates a fresh row at balance 0. */
  getOrCreate(userId: string): Promise<Wallet>;

  findByUserId(userId: string): Promise<Wallet | null>;

  /**
   * Atomic: bumps balance by `deltaInPaise` (signed) iff `expectedVersion`
   * still matches, then inserts a ledger row. Returns the updated wallet
   * + the new transaction. Caller passes the new balance pre-computed
   * (service does the arithmetic so it can also enforce non-negative).
   *
   * If the version-conditional UPDATE affects 0 rows (concurrent write
   * landed first) the implementation rejects with a tagged error so the
   * service can retry.
   */
  applyMutation(args: {
    walletId: string;
    expectedVersion: number;
    newBalanceInPaise: number;
    transaction: CreateTransactionInput;
  }): Promise<ApplyMutationResult>;

  /**
   * Insert a PENDING ledger row that does NOT change wallet balance.
   * Used when initiating a top-up: we record the intent so we have an
   * id to return + later flip to COMPLETED on signature verify.
   */
  insertPending(input: CreateTransactionInput): Promise<WalletTransaction>;

  /**
   * Flip a PENDING transaction to COMPLETED and apply the balance change
   * atomically. No-ops (returns existing) if already COMPLETED.
   */
  completePending(args: {
    transactionId: string;
    walletId: string;
    expectedVersion: number;
    newBalanceInPaise: number;
  }): Promise<ApplyMutationResult>;

  findTransactionById(id: string): Promise<WalletTransaction | null>;

  listTransactions(args: {
    userId: string;
    page: number;
    limit: number;
  }): Promise<{ items: WalletTransaction[]; total: number }>;

  listWallets(filter: ListWalletsFilter): Promise<ListWalletsPage>;

  /**
   * Set the wallet's blocked state. Returns the updated wallet.
   * Used by admin block/unblock endpoints. The service is responsible
   * for not letting normal credit/debit calls go through when blocked.
   */
  setBlocked(args: {
    userId: string;
    isBlocked: boolean;
    reason?: string | null;
    adminId?: string | null;
  }): Promise<Wallet>;
}
