import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { PostingDirection, PostingSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { CustomerService } from "../customer/customer.service.js";
import {
  dueReceivedFilterableFields,
  dueReceivedSearchableFields,
} from "./dueReceived.constant.js";
import {
  ICreateDueReceivedPayload,
  IUpdateDueReceivedPayload,
} from "./dueReceived.interface.js";

const RECEIPT_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true } },
  cashAccount1: { select: { id: true, name: true } },
  cashAccount2: { select: { id: true, name: true } },
} satisfies Prisma.DueReceivedInclude;

/**
 * Collects money against a customer's overall balance, rather than against one
 * specific sale.
 *
 * Split tender is first class: a single receipt can land in two accounts, which
 * is how these agencies actually take payment (part cash, part bKash). Each
 * half posts to its own account.
 *
 * `discount` is a write-off. It reduces what the customer owes but no money
 * arrives, so it posts to no account — that asymmetry is the whole point of
 * keeping it on this row rather than treating it as another payment.
 *
 * Over-collection is allowed and leaves the customer in credit, the same
 * reasoning as supplier advances: taking a deposit before a trip is ordinary,
 * and the resulting negative due is information, not an error.
 */
const createDueReceived = async (
  agencyId: string,
  payload: ICreateDueReceivedPayload,
  user: IRequestUser,
) => {
  const customer = await prisma.customer.findFirst({
    where: { id: payload.customerId, agencyId, isDeleted: false },
  });
  if (!customer) throw new AppError(status.NOT_FOUND, "Customer not found");

  if (payload.cashAccount2Id && payload.cashAccount2Id === payload.cashAccount1Id) {
    throw new AppError(status.BAD_REQUEST, "The two accounts must be different");
  }
  if (payload.cashAccount2Id && !(payload.amount2 && payload.amount2 > 0)) {
    throw new AppError(status.BAD_REQUEST, "A second account needs a second amount");
  }

  const date = payload.date ? new Date(payload.date) : new Date();
  const amount2 = payload.amount2 ?? 0;

  const receipt = await prisma.$transaction(async (tx) => {
    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccount1Id);
    if (payload.cashAccount2Id) {
      await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccount2Id);
    }

    const created = await tx.dueReceived.create({
      data: {
        agencyId,
        customerId: payload.customerId,
        date,
        cashAccount1Id: payload.cashAccount1Id,
        amount1: new Prisma.Decimal(payload.amount1),
        cashAccount2Id: payload.cashAccount2Id ?? null,
        amount2: new Prisma.Decimal(amount2),
        discount: new Prisma.Decimal(payload.discount ?? 0),
        discountCategory: payload.discountCategory,
        paymentReceiverId: user.userId,
        notes: payload.notes,
        createdById: user.userId,
      },
      include: RECEIPT_INCLUDE,
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccount1Id,
      direction: PostingDirection.IN,
      amount: payload.amount1,
      source: PostingSource.DUE_RECEIVED,
      sourceId: created.id,
      postedAt: date,
      note: payload.notes,
      createdById: user.userId,
    });

    if (payload.cashAccount2Id && amount2 > 0) {
      await PostingService.post(tx, {
        agencyId,
        cashAccountId: payload.cashAccount2Id,
        direction: PostingDirection.IN,
        amount: amount2,
        source: PostingSource.DUE_RECEIVED,
        sourceId: created.id,
        postedAt: date,
        note: payload.notes,
        createdById: user.userId,
      });
    }

    return created;
  });

  const due = await CustomerService.computeDue(agencyId, payload.customerId);

  return {
    receipt,
    totalReceived: payload.amount1 + amount2,
    customerDue: due.currentDue,
  };
};

const getAllDueReceived = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.DueReceivedGetPayload<object>,
    Prisma.DueReceivedWhereInput,
    Prisma.DueReceivedInclude
  >(prisma.dueReceived, query, {
    searchableFields: dueReceivedSearchableFields,
    filterableFields: dueReceivedFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include(RECEIPT_INCLUDE)
    .paginate()
    .sort()
    .fields()
    .execute();

  const totals = await prisma.dueReceived.aggregate({
    where: { agencyId },
    _sum: { amount1: true, amount2: true, discount: true },
    _count: { _all: true },
  });

  return {
    ...result,
    summary: {
      totalReceived:
        PostingService.toNumber(totals._sum.amount1) + PostingService.toNumber(totals._sum.amount2),
      totalDiscount: PostingService.toNumber(totals._sum.discount),
      totalCount: totals._count._all,
    },
  };
};

const getDueReceivedById = async (agencyId: string, id: string) => {
  const receipt = await prisma.dueReceived.findFirst({
    where: { id, agencyId },
    include: RECEIPT_INCLUDE,
  });

  if (!receipt) throw new AppError(status.NOT_FOUND, "Receipt not found");
  return receipt;
};

/**
 * Only the date, discount, category and notes are editable. Amounts and
 * accounts have already moved balances, so changing them in place would leave
 * the ledger describing something that never happened.
 *
 * Editing the discount is safe precisely because a discount posts to no
 * account — it only moves what the customer owes.
 */
const updateDueReceived = async (agencyId: string, id: string, payload: IUpdateDueReceivedPayload) => {
  const existing = await prisma.dueReceived.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Receipt not found");

  const date = payload.date ? new Date(payload.date) : undefined;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.dueReceived.update({
      where: { id },
      data: {
        date,
        ...(payload.discount !== undefined && { discount: new Prisma.Decimal(payload.discount) }),
        discountCategory: payload.discountCategory,
        notes: payload.notes,
      },
      include: RECEIPT_INCLUDE,
    });

    if (date) {
      await tx.accountPosting.updateMany({
        where: { source: PostingSource.DUE_RECEIVED, sourceId: id },
        data: { postedAt: date },
      });
    }

    return updated;
  });
};

const deleteDueReceived = async (agencyId: string, id: string) => {
  const existing = await prisma.dueReceived.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Receipt not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.DUE_RECEIVED, id);
    await tx.dueReceived.delete({ where: { id } });
  });

  return { message: "Receipt deleted successfully" };
};

export const DueReceivedService = {
  createDueReceived,
  getAllDueReceived,
  getDueReceivedById,
  updateDueReceived,
  deleteDueReceived,
};
