import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  CapitalFlowType,
  PostingDirection,
  PostingSource,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import {
  ICreateCapitalFlowPayload,
  ICreateProfitWithdrawalPayload,
  IUpdateDateNotePayload,
} from "./capital.interface.js";

const toNumber = PostingService.toNumber;

const ACCOUNT_SELECT = { cashAccount: { select: { id: true, name: true } } };

/**
 * Owner money entering or leaving the business.
 *
 * None of this existed before. The old schema had an OWNER_FUNDS account
 * category, but it was a label with no behaviour attached — there was no way to
 * record that an owner had put money in or taken it out, so the only route for
 * capital was to type it into an account's opening balance and hope nobody
 * needed to know where it came from.
 */
const createCapitalFlow = async (
  agencyId: string,
  payload: ICreateCapitalFlowPayload,
  user: IRequestUser,
) => {
  const date = payload.date ? new Date(payload.date) : new Date();
  const isInvestment = payload.type === CapitalFlowType.INVEST;

  return prisma.$transaction(async (tx) => {
    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId);

    const flow = await tx.capitalFlow.create({
      data: {
        agencyId,
        ownerName: payload.ownerName,
        type: payload.type,
        amount: new Prisma.Decimal(payload.amount),
        cashAccountId: payload.cashAccountId,
        date,
        note: payload.note,
        createdById: user.userId,
      },
      include: ACCOUNT_SELECT,
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccountId,
      direction: isInvestment ? PostingDirection.IN : PostingDirection.OUT,
      amount: payload.amount,
      source: isInvestment ? PostingSource.INVESTMENT : PostingSource.INVESTMENT_WITHDRAWAL,
      sourceId: flow.id,
      postedAt: date,
      note: payload.note,
      createdById: user.userId,
    });

    return flow;
  });
};

const getAllCapitalFlows = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.CapitalFlowGetPayload<object>,
    Prisma.CapitalFlowWhereInput,
    Prisma.CapitalFlowInclude
  >(prisma.capitalFlow, query, {
    searchableFields: ["ownerName", "note", "cashAccount.name"],
    filterableFields: ["type", "cashAccountId", "ownerName", "date"],
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include(ACCOUNT_SELECT)
    .paginate()
    .sort()
    .fields()
    .execute();

  const [invested, withdrawn] = await Promise.all([
    prisma.capitalFlow.aggregate({
      where: { agencyId, type: CapitalFlowType.INVEST },
      _sum: { amount: true },
    }),
    prisma.capitalFlow.aggregate({
      where: { agencyId, type: CapitalFlowType.WITHDRAW },
      _sum: { amount: true },
    }),
  ]);

  const totalInvest = toNumber(invested._sum.amount);
  const totalWithdraw = toNumber(withdrawn._sum.amount);

  return {
    ...result,
    summary: { totalInvest, totalWithdraw, netInvestment: totalInvest - totalWithdraw },
  };
};

/** Per-owner totals, for the investment summary panel. */
const getCapitalSummary = async (agencyId: string) => {
  const grouped = await prisma.capitalFlow.groupBy({
    by: ["ownerName", "type"],
    where: { agencyId },
    _sum: { amount: true },
  });

  const owners = new Map<string, { invested: number; withdrawn: number }>();
  for (const row of grouped) {
    const entry = owners.get(row.ownerName) ?? { invested: 0, withdrawn: 0 };
    if (row.type === CapitalFlowType.INVEST) entry.invested = toNumber(row._sum.amount);
    else entry.withdrawn = toNumber(row._sum.amount);
    owners.set(row.ownerName, entry);
  }

  const rows = [...owners.entries()].map(([ownerName, totals]) => ({
    ownerName,
    ...totals,
    netInvestment: totals.invested - totals.withdrawn,
  }));

  const netTotal = rows.reduce((sum, r) => sum + r.netInvestment, 0);

  return {
    owners: rows.map((r) => ({
      ...r,
      // Share of the business by capital contributed.
      sharePercent: netTotal > 0 ? (r.netInvestment / netTotal) * 100 : 0,
    })),
    summary: {
      totalOwners: rows.length,
      totalInvest: rows.reduce((sum, r) => sum + r.invested, 0),
      totalWithdraw: rows.reduce((sum, r) => sum + r.withdrawn, 0),
      netInvestment: netTotal,
    },
  };
};

const updateCapitalFlow = async (agencyId: string, id: string, payload: IUpdateDateNotePayload) => {
  const existing = await prisma.capitalFlow.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Capital entry not found");

  const date = payload.date ? new Date(payload.date) : undefined;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.capitalFlow.update({
      where: { id },
      data: { date, note: payload.note },
      include: ACCOUNT_SELECT,
    });

    if (date) {
      await tx.accountPosting.updateMany({
        where: {
          sourceId: id,
          source: { in: [PostingSource.INVESTMENT, PostingSource.INVESTMENT_WITHDRAWAL] },
        },
        data: { postedAt: date },
      });
    }

    return updated;
  });
};

const deleteCapitalFlow = async (agencyId: string, id: string) => {
  const existing = await prisma.capitalFlow.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Capital entry not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.INVESTMENT, id);
    await PostingService.reverse(tx, PostingSource.INVESTMENT_WITHDRAWAL, id);
    await tx.capitalFlow.delete({ where: { id } });
  });

  return { message: "Capital entry deleted successfully" };
};

/* -------------------------- profit withdrawals -------------------------- */

/**
 * Profit taken out of the business, tracked separately from invested capital
 * because the dashboards report the two on different lines: one reduces
 * retained profit, the other reduces the owner's stake.
 */
const createProfitWithdrawal = async (
  agencyId: string,
  payload: ICreateProfitWithdrawalPayload,
  user: IRequestUser,
) => {
  const date = payload.date ? new Date(payload.date) : new Date();

  return prisma.$transaction(async (tx) => {
    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId);

    const withdrawal = await tx.profitWithdrawal.create({
      data: {
        agencyId,
        receivedBy: payload.receivedBy,
        amount: new Prisma.Decimal(payload.amount),
        cashAccountId: payload.cashAccountId,
        date,
        note: payload.note,
        createdById: user.userId,
      },
      include: ACCOUNT_SELECT,
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccountId,
      direction: PostingDirection.OUT,
      amount: payload.amount,
      source: PostingSource.PROFIT_WITHDRAWAL,
      sourceId: withdrawal.id,
      postedAt: date,
      note: payload.note,
      createdById: user.userId,
    });

    return withdrawal;
  });
};

const getAllProfitWithdrawals = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.ProfitWithdrawalGetPayload<object>,
    Prisma.ProfitWithdrawalWhereInput,
    Prisma.ProfitWithdrawalInclude
  >(prisma.profitWithdrawal, query, {
    searchableFields: ["receivedBy", "note", "cashAccount.name"],
    filterableFields: ["cashAccountId", "receivedBy", "date"],
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include(ACCOUNT_SELECT)
    .paginate()
    .sort()
    .fields()
    .execute();

  const totals = await prisma.profitWithdrawal.aggregate({
    where: { agencyId },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    ...result,
    summary: {
      totalWithdrawn: toNumber(totals._sum.amount),
      totalCount: totals._count._all,
    },
  };
};

const updateProfitWithdrawal = async (agencyId: string, id: string, payload: IUpdateDateNotePayload) => {
  const existing = await prisma.profitWithdrawal.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Profit withdrawal not found");

  const date = payload.date ? new Date(payload.date) : undefined;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.profitWithdrawal.update({
      where: { id },
      data: { date, note: payload.note },
      include: ACCOUNT_SELECT,
    });

    if (date) {
      await tx.accountPosting.updateMany({
        where: { source: PostingSource.PROFIT_WITHDRAWAL, sourceId: id },
        data: { postedAt: date },
      });
    }

    return updated;
  });
};

const deleteProfitWithdrawal = async (agencyId: string, id: string) => {
  const existing = await prisma.profitWithdrawal.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Profit withdrawal not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.PROFIT_WITHDRAWAL, id);
    await tx.profitWithdrawal.delete({ where: { id } });
  });

  return { message: "Profit withdrawal deleted successfully" };
};

export const CapitalService = {
  createCapitalFlow,
  getAllCapitalFlows,
  getCapitalSummary,
  updateCapitalFlow,
  deleteCapitalFlow,
  createProfitWithdrawal,
  getAllProfitWithdrawals,
  updateProfitWithdrawal,
  deleteProfitWithdrawal,
};
