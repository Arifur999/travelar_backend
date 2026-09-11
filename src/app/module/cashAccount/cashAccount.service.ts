import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { PostingDirection, PostingSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { ICreateCashAccountPayload, IUpdateCashAccountPayload } from "./cashAccount.interface.js";
import { PostingService } from "./posting.service.js";

const createCashAccount = async (agencyId: string, payload: ICreateCashAccountPayload, user: IRequestUser) => {
  const duplicate = await prisma.cashAccount.findFirst({
    where: { agencyId, name: { equals: payload.name, mode: "insensitive" } },
  });
  if (duplicate) {
    throw new AppError(status.CONFLICT, "An account with this name already exists");
  }

  const opening = payload.openingBalance ?? 0;

  return prisma.$transaction(async (tx) => {
    const account = await tx.cashAccount.create({
      data: {
        agencyId,
        name: payload.name,
        category: payload.category,
        openingBalance: new Prisma.Decimal(opening),
        isActive: payload.isActive ?? true,
        createdById: user.userId,
      },
    });

    // Recorded as a posting as well as an opening column so the ledger alone
    // explains the whole balance and the dashboard's "opening" line has a row
    // behind it like every other movement.
    if (opening !== 0) {
      await tx.accountPosting.create({
        data: {
          agencyId,
          cashAccountId: account.id,
          direction: opening > 0 ? PostingDirection.IN : PostingDirection.OUT,
          amount: new Prisma.Decimal(Math.abs(opening)),
          source: PostingSource.OPENING,
          sourceId: account.id,
          note: "Opening balance",
          createdById: user.userId,
        },
      });
    }

    return account;
  });
};

const getAllCashAccounts = async (agencyId: string) => {
  const balances = await PostingService.getBalances(agencyId);

  const activeBalances = balances.filter((a) => a.isActive);
  const inactiveBalances = balances.filter((a) => !a.isActive);

  return {
    data: balances,
    summary: {
      totalAccounts: balances.length,
      activeAccounts: activeBalances.length,
      totalBalance: activeBalances.reduce((sum, a) => sum + a.currentBalance, 0),
      inactiveBalance: inactiveBalances.reduce((sum, a) => sum + a.currentBalance, 0),
    },
  };
};

/// The Balance Dashboard: one row per account, one column per money source.
const getOverview = async (agencyId: string) => {
  const [balances, breakdown] = await Promise.all([
    PostingService.getBalances(agencyId),
    PostingService.getBreakdown(agencyId),
  ]);

  const rows = balances.map((account) => ({
    ...account,
    bySource: breakdown.get(account.id) ?? {},
  }));

  return {
    data: rows,
    summary: {
      totalAccounts: rows.length,
      totalBalance: rows.filter((r) => r.isActive).reduce((sum, r) => sum + r.currentBalance, 0),
      inactiveBalance: rows.filter((r) => !r.isActive).reduce((sum, r) => sum + r.currentBalance, 0),
    },
  };
};

const getCashAccountById = async (agencyId: string, id: string) => {
  const account = await prisma.cashAccount.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!account) throw new AppError(status.NOT_FOUND, "Cash account not found");

  return PostingService.getBalance(agencyId, id);
};

const updateCashAccount = async (agencyId: string, id: string, payload: IUpdateCashAccountPayload) => {
  const account = await prisma.cashAccount.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!account) throw new AppError(status.NOT_FOUND, "Cash account not found");

  if (payload.name && payload.name.toLowerCase() !== account.name.toLowerCase()) {
    const duplicate = await prisma.cashAccount.findFirst({
      where: { agencyId, name: { equals: payload.name, mode: "insensitive" }, id: { not: id } },
    });
    if (duplicate) throw new AppError(status.CONFLICT, "An account with this name already exists");
  }

  await prisma.cashAccount.update({ where: { id }, data: payload });
  return PostingService.getBalance(agencyId, id);
};

/**
 * Soft delete, refused while the account has any movement other than its own
 * opening entry. Removing an account that money has passed through would
 * orphan postings and make the ledger unexplainable.
 */
const deleteCashAccount = async (agencyId: string, id: string) => {
  const account = await prisma.cashAccount.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!account) throw new AppError(status.NOT_FOUND, "Cash account not found");

  const movements = await prisma.accountPosting.count({
    where: { agencyId, cashAccountId: id, source: { not: PostingSource.OPENING } },
  });

  if (movements > 0) {
    throw new AppError(
      status.BAD_REQUEST,
      "This account has transactions and cannot be deleted. Mark it inactive instead.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.accountPosting.deleteMany({ where: { cashAccountId: id } });
    await tx.cashAccount.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
  });

  return { message: "Cash account deleted successfully" };
};

export const CashAccountService = {
  createCashAccount,
  getAllCashAccounts,
  getOverview,
  getCashAccountById,
  updateCashAccount,
  deleteCashAccount,
};
