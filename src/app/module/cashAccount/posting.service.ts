import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { PostingDirection, PostingSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";

/// Prisma's transaction client, so callers can post inside their own transaction.
type Tx = Prisma.TransactionClient;

export interface IPostMoneyArgs {
  agencyId: string;
  cashAccountId: string;
  direction: PostingDirection;
  amount: number;
  source: PostingSource;
  /// The row that caused this posting, so it can be reversed later by source.
  sourceId?: string | null;
  postedAt?: Date;
  note?: string | null;
  createdById?: string | null;
}

export interface IAccountBalance {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  currentBalance: number;
}

const toNumber = (value: Prisma.Decimal | null | undefined) =>
  value === null || value === undefined ? 0 : value.toNumber();

/**
 * The one place a cash account is checked before money moves against it.
 * Anything that posts must go through here, so "does this account exist, belong
 * to this agency, and is it usable" has a single answer.
 */
const assertPostableAccount = async (client: Tx, agencyId: string, cashAccountId: string) => {
  const account = await client.cashAccount.findFirst({
    where: { id: cashAccountId, agencyId, isDeleted: false },
  });

  if (!account) {
    throw new AppError(status.NOT_FOUND, "Cash account not found");
  }
  if (!account.isActive) {
    throw new AppError(status.BAD_REQUEST, "This account is inactive and cannot be used");
  }

  return account;
};

/** Writes one posting. Always call inside the caller's transaction. */
const post = async (client: Tx, args: IPostMoneyArgs) => {
  if (!(args.amount > 0)) {
    throw new AppError(status.BAD_REQUEST, "Amount must be greater than zero");
  }

  await assertPostableAccount(client, args.agencyId, args.cashAccountId);

  return client.accountPosting.create({
    data: {
      agencyId: args.agencyId,
      cashAccountId: args.cashAccountId,
      direction: args.direction,
      amount: new Prisma.Decimal(args.amount),
      source: args.source,
      sourceId: args.sourceId ?? null,
      postedAt: args.postedAt ?? new Date(),
      note: args.note ?? null,
      createdById: args.createdById ?? null,
    },
  });
};

/**
 * Removes every posting a given row produced. This is what makes each operation
 * exactly reversible: delete the cause, delete its postings, and the balance
 * returns to what it was — no compensating arithmetic that can drift.
 */
const reverse = async (client: Tx, source: PostingSource, sourceId: string) =>
  client.accountPosting.deleteMany({ where: { source, sourceId } });

/**
 * The single derivation of an account balance: everything posted in, minus
 * everything posted out. The opening balance is itself a posting (source
 * OPENING) written when the account is created, so the ledger alone explains
 * the whole figure and nothing is counted twice.
 *
 * Every caller that needs a balance calls this. The implementation this
 * replaces kept a stored running balance that six writers mutated AND
 * re-derived the same number elsewhere from only three of them, so the two
 * silently drifted apart by the value of every supplier payment and staff
 * payout ever made.
 */
const getBalances = async (agencyId: string, cashAccountIds?: string[]): Promise<IAccountBalance[]> => {
  const where: Prisma.CashAccountWhereInput = { agencyId, isDeleted: false };
  if (cashAccountIds) where.id = { in: cashAccountIds };

  const accounts = await prisma.cashAccount.findMany({ where, orderBy: { createdAt: "asc" } });
  if (accounts.length === 0) return [];

  const grouped = await prisma.accountPosting.groupBy({
    by: ["cashAccountId", "direction"],
    where: { agencyId, cashAccountId: { in: accounts.map((a) => a.id) } },
    _sum: { amount: true },
  });

  const sums = new Map<string, { in: number; out: number }>();
  for (const row of grouped) {
    const entry = sums.get(row.cashAccountId) ?? { in: 0, out: 0 };
    if (row.direction === PostingDirection.IN) entry.in = toNumber(row._sum.amount);
    else entry.out = toNumber(row._sum.amount);
    sums.set(row.cashAccountId, entry);
  }

  return accounts.map((account) => {
    const { in: totalIn, out: totalOut } = sums.get(account.id) ?? { in: 0, out: 0 };
    const openingBalance = toNumber(account.openingBalance);

    return {
      id: account.id,
      name: account.name,
      category: account.category,
      isActive: account.isActive,
      openingBalance,
      totalIn,
      totalOut,
      currentBalance: totalIn - totalOut,
    };
  });
};

/** Balance of one account, for guards. */
const getBalance = async (agencyId: string, cashAccountId: string) => {
  const [result] = await getBalances(agencyId, [cashAccountId]);
  if (!result) throw new AppError(status.NOT_FOUND, "Cash account not found");
  return result;
};

/**
 * Per-source movement per account — the Balance Dashboard in the source
 * spreadsheet, where each column is one PostingSource.
 */
const getBreakdown = async (agencyId: string) => {
  const grouped = await prisma.accountPosting.groupBy({
    by: ["cashAccountId", "source", "direction"],
    where: { agencyId },
    _sum: { amount: true },
  });

  const byAccount = new Map<string, Record<string, number>>();
  for (const row of grouped) {
    const entry = byAccount.get(row.cashAccountId) ?? {};
    const signed = toNumber(row._sum.amount);
    entry[row.source] = (entry[row.source] ?? 0) + (row.direction === PostingDirection.IN ? signed : -signed);
    byAccount.set(row.cashAccountId, entry);
  }

  return byAccount;
};

/**
 * Refuses a withdrawal that would overdraw the account.
 *
 * Applied only where the business actually wants it — a transfer between the
 * agency's own accounts. Expenses, supplier payments and payouts are allowed to
 * go negative, matching how the agency already works on paper.
 */
const assertSufficientBalance = async (agencyId: string, cashAccountId: string, amount: number) => {
  const { currentBalance, name } = await getBalance(agencyId, cashAccountId);
  if (currentBalance < amount) {
    throw new AppError(
      status.BAD_REQUEST,
      `Insufficient balance in ${name}: available ${currentBalance.toFixed(2)}, needed ${amount.toFixed(2)}`,
    );
  }
};

export const PostingService = {
  post,
  reverse,
  getBalances,
  getBalance,
  getBreakdown,
  assertPostableAccount,
  assertSufficientBalance,
  toNumber,
};
