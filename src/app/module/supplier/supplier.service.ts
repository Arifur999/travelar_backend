import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { supplierFilterableFields, supplierSearchableFields } from "./supplier.constant.js";
import {
  ICreateSupplierPayload,
  ISupplierLedgerTotals,
  IUpdateSupplierPayload,
} from "./supplier.interface.js";

const toNumber = PostingService.toNumber;

/**
 * What the agency owes a supplier:
 *
 *   currentPayable = openingPayable + Σ purchases − Σ payments
 *
 * Purchases are the buying price of every live ticket bought from that
 * supplier. In the implementation this replaces, a ticket's cost posted to
 * nothing and the supplier was a free-text string, so payable only ever went
 * *down* from a hand-typed opening figure and went negative the moment you paid
 * more than it.
 *
 * A negative figure here is meaningful and allowed: it is an advance sitting
 * with the supplier.
 *
 * Computed in a fixed number of queries no matter how many suppliers are asked
 * for, so the list endpoint does not fan out per row.
 */
const attachLedgerTotals = async <T extends { id: string; openingPayable: Prisma.Decimal }>(
  agencyId: string,
  suppliers: T[],
): Promise<(Omit<T, "openingPayable"> & ISupplierLedgerTotals)[]> => {
  if (suppliers.length === 0) return [];

  const supplierIds = suppliers.map((s) => s.id);

  const [purchaseAgg, paymentAgg] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["supplierId"],
      where: { agencyId, isDeleted: false, supplierId: { in: supplierIds } },
      _sum: { cost: true },
    }),
    prisma.supplierTransaction.groupBy({
      by: ["supplierId"],
      where: { agencyId, supplierId: { in: supplierIds } },
      _sum: { amount: true },
    }),
  ]);

  const purchaseMap = new Map(purchaseAgg.map((p) => [p.supplierId, toNumber(p._sum.cost)]));
  const paymentMap = new Map(paymentAgg.map((p) => [p.supplierId, toNumber(p._sum.amount)]));

  return suppliers.map((supplier) => {
    const openingPayable = toNumber(supplier.openingPayable);
    const totalPurchase = purchaseMap.get(supplier.id) ?? 0;
    const totalPaid = paymentMap.get(supplier.id) ?? 0;

    return {
      ...supplier,
      openingPayable,
      totalPurchase,
      totalPaid,
      currentPayable: openingPayable + totalPurchase - totalPaid,
    };
  });
};

const computePayable = async (agencyId: string, supplierId: string) => {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, agencyId, isDeleted: false },
  });
  if (!supplier) throw new AppError(status.NOT_FOUND, "Supplier not found");

  const [withTotals] = await attachLedgerTotals(agencyId, [supplier]);
  return withTotals!;
};

const createSupplier = async (agencyId: string, payload: ICreateSupplierPayload, user: IRequestUser) => {
  const duplicate = await prisma.supplier.findFirst({
    where: { agencyId, name: { equals: payload.name, mode: "insensitive" } },
  });
  if (duplicate) {
    throw new AppError(status.CONFLICT, "A supplier with this name already exists");
  }

  const supplier = await prisma.supplier.create({
    data: {
      agencyId,
      name: payload.name,
      contactName: payload.contactName,
      phone: payload.phone,
      address: payload.address,
      openingPayable: new Prisma.Decimal(payload.openingPayable ?? 0),
      createdById: user.userId,
    },
  });

  return computePayable(agencyId, supplier.id);
};

const getAllSuppliers = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.SupplierGetPayload<object>,
    Prisma.SupplierWhereInput,
    Prisma.SupplierInclude
  >(prisma.supplier, query, {
    searchableFields: supplierSearchableFields,
    filterableFields: supplierFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .paginate()
    .sort()
    .fields()
    .execute();

  return { ...result, data: await attachLedgerTotals(agencyId, result.data) };
};

/**
 * Whole-book totals for the supplier dashboard. Aggregated in SQL rather than
 * loaded and reduced in memory, which is what the previous implementation did
 * on every dashboard hit with no pagination.
 */
const getSupplierDashboard = async (agencyId: string, sort?: string) => {
  const suppliers = await prisma.supplier.findMany({ where: { agencyId, isDeleted: false } });
  const withTotals = await attachLedgerTotals(agencyId, suppliers);

  if (sort === "currentPayableAsc") {
    withTotals.sort((a, b) => a.currentPayable - b.currentPayable);
  } else if (sort === "nameAsc") {
    withTotals.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    withTotals.sort((a, b) => b.currentPayable - a.currentPayable);
  }

  return {
    data: withTotals,
    summary: {
      totalSuppliers: withTotals.length,
      totalOpeningPayable: withTotals.reduce((sum, s) => sum + s.openingPayable, 0),
      totalPurchase: withTotals.reduce((sum, s) => sum + s.totalPurchase, 0),
      totalPaid: withTotals.reduce((sum, s) => sum + s.totalPaid, 0),
      totalCurrentPayable: withTotals.reduce((sum, s) => sum + s.currentPayable, 0),
    },
  };
};

const getSupplierById = async (agencyId: string, id: string) => computePayable(agencyId, id);

/**
 * Chronological statement with a running payable, opening balance first.
 * Purchases increase what is owed, payments reduce it.
 */
const getSupplierLedger = async (agencyId: string, id: string) => {
  const supplier = await computePayable(agencyId, id);

  const [tickets, payments] = await Promise.all([
    prisma.ticket.findMany({
      where: { agencyId, supplierId: id, isDeleted: false },
      select: { id: true, pnr: true, cost: true, issueDate: true, createdAt: true, passengerName: true },
    }),
    prisma.supplierTransaction.findMany({
      where: { agencyId, supplierId: id },
      include: { cashAccount: { select: { id: true, name: true } } },
    }),
  ]);

  type LedgerRow = {
    date: Date;
    type: string;
    description: string;
    debit: number;
    credit: number;
    runningPayable: number;
  };

  const events: Omit<LedgerRow, "runningPayable">[] = [];

  for (const ticket of tickets) {
    events.push({
      date: ticket.issueDate ?? ticket.createdAt,
      type: "purchase",
      description: `Ticket purchase — PNR ${ticket.pnr} (${ticket.passengerName})`,
      debit: toNumber(ticket.cost),
      credit: 0,
    });
  }

  for (const payment of payments) {
    events.push({
      date: payment.date,
      type: "payment",
      description: `Payment — ${payment.cashAccount.name}`,
      debit: 0,
      credit: toNumber(payment.amount),
    });
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = supplier.openingPayable;
  const rows: LedgerRow[] = [
    {
      date: supplier.createdAt,
      type: "opening",
      description: "Opening payable",
      debit: supplier.openingPayable,
      credit: 0,
      runningPayable: running,
    },
  ];

  for (const event of events) {
    running = running + event.debit - event.credit;
    rows.push({ ...event, runningPayable: running });
  }

  return { supplier, rows };
};

const updateSupplier = async (agencyId: string, id: string, payload: IUpdateSupplierPayload) => {
  const supplier = await prisma.supplier.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!supplier) throw new AppError(status.NOT_FOUND, "Supplier not found");

  if (payload.name && payload.name.toLowerCase() !== supplier.name.toLowerCase()) {
    const duplicate = await prisma.supplier.findFirst({
      where: { agencyId, name: { equals: payload.name, mode: "insensitive" }, id: { not: id } },
    });
    if (duplicate) throw new AppError(status.CONFLICT, "A supplier with this name already exists");
  }

  await prisma.supplier.update({
    where: { id },
    data: {
      name: payload.name,
      contactName: payload.contactName,
      phone: payload.phone,
      address: payload.address,
      ...(payload.openingPayable !== undefined && {
        openingPayable: new Prisma.Decimal(payload.openingPayable),
      }),
    },
  });

  return computePayable(agencyId, id);
};

/**
 * Soft delete, refused while the supplier has any history. Removing one that
 * tickets or payments still point at would leave those rows describing a
 * supplier nobody can look up.
 */
const deleteSupplier = async (agencyId: string, id: string) => {
  const supplier = await prisma.supplier.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!supplier) throw new AppError(status.NOT_FOUND, "Supplier not found");

  const [paymentCount, ticketCount] = await Promise.all([
    prisma.supplierTransaction.count({ where: { agencyId, supplierId: id } }),
    prisma.ticket.count({ where: { agencyId, supplierId: id, isDeleted: false } }),
  ]);

  if (paymentCount > 0 || ticketCount > 0) {
    throw new AppError(
      status.BAD_REQUEST,
      "This supplier has transaction history and cannot be deleted",
    );
  }

  await prisma.supplier.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  return { message: "Supplier deleted successfully" };
};

export const SupplierService = {
  attachLedgerTotals,
  computePayable,
  createSupplier,
  getAllSuppliers,
  getSupplierDashboard,
  getSupplierById,
  getSupplierLedger,
  updateSupplier,
  deleteSupplier,
};
