import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { PostingDirection, PostingSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import {
  balanceTransferFilterableFields,
  balanceTransferSearchableFields,
} from "./balanceTransfer.constant.js";
import {
  ICreateBalanceTransferPayload,
  IUpdateBalanceTransferPayload,
} from "./balanceTransfer.interface.js";

/**
 * Moves money between two of the agency's own accounts. Net effect on the total
 * balance is zero, so it writes a matched OUT/IN pair inside one transaction —
 * there is no state where one side landed and the other did not.
 *
 * This is the only operation with an insufficient-balance guard. Expenses,
 * supplier payments and payouts deliberately allow an account to go negative
 * because that reflects how the agency already works on paper; moving money you
 * do not have between your own accounts is always a mistake.
 *
 * The guard runs inside the transaction and locks the source account — see
 * PostingService.assertSufficientBalance for why checking it beforehand was
 * not a guard at all.
 */
const createBalanceTransfer = async (
  agencyId: string,
  payload: ICreateBalanceTransferPayload,
  user: IRequestUser,
) => {
  if (payload.fromAccountId === payload.toAccountId) {
    throw new AppError(status.BAD_REQUEST, "Source and destination account cannot be the same");
  }

  const date = payload.date ? new Date(payload.date) : new Date();

  return prisma.$transaction(async (tx) => {
    // First statement in the transaction: it locks the source account, so
    // simultaneous transfers out of it queue up instead of each reading the
    // same balance and all being allowed. Only the source is locked, so a pair
    // of transfers in opposite directions cannot deadlock.
    await PostingService.assertSufficientBalance(tx, agencyId, payload.fromAccountId, payload.amount);

    await PostingService.assertPostableAccount(tx, agencyId, payload.fromAccountId);
    await PostingService.assertPostableAccount(tx, agencyId, payload.toAccountId);

    const transfer = await tx.balanceTransfer.create({
      data: {
        agencyId,
        fromAccountId: payload.fromAccountId,
        toAccountId: payload.toAccountId,
        amount: new Prisma.Decimal(payload.amount),
        date,
        note: payload.note,
        transferredById: user.userId,
      },
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
      },
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.fromAccountId,
      direction: PostingDirection.OUT,
      amount: payload.amount,
      source: PostingSource.TRANSFER_OUT,
      sourceId: transfer.id,
      postedAt: date,
      note: payload.note,
      createdById: user.userId,
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.toAccountId,
      direction: PostingDirection.IN,
      amount: payload.amount,
      source: PostingSource.TRANSFER_IN,
      sourceId: transfer.id,
      postedAt: date,
      note: payload.note,
      createdById: user.userId,
    });

    return transfer;
  });
};

const getAllBalanceTransfers = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.BalanceTransferGetPayload<object>,
    Prisma.BalanceTransferWhereInput,
    Prisma.BalanceTransferInclude
  >(prisma.balanceTransfer, query, {
    searchableFields: balanceTransferSearchableFields,
    filterableFields: balanceTransferFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include({
      fromAccount: { select: { id: true, name: true } },
      toAccount: { select: { id: true, name: true } },
    })
    .paginate()
    .sort()
    .fields()
    .execute();

  const totals = await prisma.balanceTransfer.aggregate({
    where: { agencyId },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    ...result,
    summary: {
      totalAmount: PostingService.toNumber(totals._sum.amount),
      totalCount: totals._count._all,
    },
  };
};

const getBalanceTransferById = async (agencyId: string, id: string) => {
  const transfer = await prisma.balanceTransfer.findFirst({
    where: { id, agencyId },
    include: {
      fromAccount: { select: { id: true, name: true } },
      toAccount: { select: { id: true, name: true } },
    },
  });

  if (!transfer) throw new AppError(status.NOT_FOUND, "Balance transfer not found");
  return transfer;
};

const updateBalanceTransfer = async (
  agencyId: string,
  id: string,
  payload: IUpdateBalanceTransferPayload,
) => {
  const existing = await prisma.balanceTransfer.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Balance transfer not found");

  const date = payload.date ? new Date(payload.date) : undefined;

  return prisma.$transaction(async (tx) => {
    const transfer = await tx.balanceTransfer.update({
      where: { id },
      data: { date, note: payload.note },
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
      },
    });

    // Keep the ledger's own timestamps in step with the row they came from.
    if (date) {
      await tx.accountPosting.updateMany({
        where: {
          sourceId: id,
          source: { in: [PostingSource.TRANSFER_IN, PostingSource.TRANSFER_OUT] },
        },
        data: { postedAt: date },
      });
    }

    return transfer;
  });
};

const deleteBalanceTransfer = async (agencyId: string, id: string) => {
  const existing = await prisma.balanceTransfer.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Balance transfer not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.TRANSFER_OUT, id);
    await PostingService.reverse(tx, PostingSource.TRANSFER_IN, id);
    await tx.balanceTransfer.delete({ where: { id } });
  });

  return { message: "Balance transfer deleted successfully" };
};

export const BalanceTransferService = {
  createBalanceTransfer,
  getAllBalanceTransfers,
  getBalanceTransferById,
  updateBalanceTransfer,
  deleteBalanceTransfer,
};
