import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { PostingDirection, PostingSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { SupplierService } from "../supplier/supplier.service.js";
import {
  supplierTransactionFilterableFields,
  supplierTransactionSearchableFields,
} from "./supplierTransaction.constant.js";
import {
  ICreateSupplierTransactionPayload,
  IUpdateSupplierTransactionPayload,
} from "./supplierTransaction.interface.js";

/**
 * Records a payment made to a supplier and posts it out of a cash account.
 *
 * Deliberately NOT blocked when it exceeds what is currently owed: paying a
 * supplier in advance is ordinary practice, and the resulting negative payable
 * is meaningful — it is money sitting with the supplier. The response returns
 * the recomputed payable so the caller can show it as an advance rather than
 * discovering it later.
 */
const createSupplierTransaction = async (
  agencyId: string,
  payload: ICreateSupplierTransactionPayload,
  user: IRequestUser,
) => {
  const supplier = await prisma.supplier.findFirst({
    where: { id: payload.supplierId, agencyId, isDeleted: false },
  });
  if (!supplier) throw new AppError(status.NOT_FOUND, "Supplier not found");

  const date = payload.date ? new Date(payload.date) : new Date();

  const transaction = await prisma.$transaction(async (tx) => {
    // Validates the account exists, belongs to this agency and is active.
    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId);

    const created = await tx.supplierTransaction.create({
      data: {
        agencyId,
        supplierId: payload.supplierId,
        cashAccountId: payload.cashAccountId,
        amount: new Prisma.Decimal(payload.amount),
        date,
        note: payload.note,
        paidById: user.userId,
        createdById: user.userId,
      },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        cashAccount: { select: { id: true, name: true } },
      },
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccountId,
      direction: PostingDirection.OUT,
      amount: payload.amount,
      source: PostingSource.SUPPLIER_PAYMENT,
      sourceId: created.id,
      postedAt: date,
      note: payload.note,
      createdById: user.userId,
    });

    return created;
  });

  const payable = await SupplierService.computePayable(agencyId, payload.supplierId);

  return { transaction, supplierPayable: payable.currentPayable };
};

const getAllSupplierTransactions = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.SupplierTransactionGetPayload<object>,
    Prisma.SupplierTransactionWhereInput,
    Prisma.SupplierTransactionInclude
  >(prisma.supplierTransaction, query, {
    searchableFields: supplierTransactionSearchableFields,
    filterableFields: supplierTransactionFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include({
      supplier: { select: { id: true, name: true, phone: true } },
      cashAccount: { select: { id: true, name: true } },
    })
    .paginate()
    .sort()
    .fields()
    .execute();

  const totals = await prisma.supplierTransaction.aggregate({
    where: { agencyId },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    ...result,
    summary: {
      totalPaid: PostingService.toNumber(totals._sum.amount),
      totalCount: totals._count._all,
    },
  };
};

const getSupplierTransactionById = async (agencyId: string, id: string) => {
  const transaction = await prisma.supplierTransaction.findFirst({
    where: { id, agencyId },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      cashAccount: { select: { id: true, name: true } },
    },
  });

  if (!transaction) throw new AppError(status.NOT_FOUND, "Supplier payment not found");
  return transaction;
};

/**
 * Only the date and note are editable. The amount and the account have already
 * moved a balance, so changing them in place would leave the ledger describing
 * something that never happened — delete and recreate instead.
 */
const updateSupplierTransaction = async (
  agencyId: string,
  id: string,
  payload: IUpdateSupplierTransactionPayload,
) => {
  const existing = await prisma.supplierTransaction.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Supplier payment not found");

  const date = payload.date ? new Date(payload.date) : undefined;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.supplierTransaction.update({
      where: { id },
      data: { date, note: payload.note },
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        cashAccount: { select: { id: true, name: true } },
      },
    });

    if (date) {
      await tx.accountPosting.updateMany({
        where: { source: PostingSource.SUPPLIER_PAYMENT, sourceId: id },
        data: { postedAt: date },
      });
    }

    return updated;
  });
};

const deleteSupplierTransaction = async (agencyId: string, id: string) => {
  const existing = await prisma.supplierTransaction.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Supplier payment not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.SUPPLIER_PAYMENT, id);
    await tx.supplierTransaction.delete({ where: { id } });
  });

  return { message: "Supplier payment deleted successfully" };
};

export const SupplierTransactionService = {
  createSupplierTransaction,
  getAllSupplierTransactions,
  getSupplierTransactionById,
  updateSupplierTransaction,
  deleteSupplierTransaction,
};
