import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  PostingDirection,
  PostingSource,
  TicketStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { lockRow } from "../../utils/rowLock.js";
import {
  TICKET_TRANSITIONS,
  ticketFilterableFields,
  ticketSearchableFields,
} from "./ticket.constant.js";
import {
  IChangeTicketStatusPayload,
  ICreateTicketPayload,
  IRecordTicketPaymentPayload,
  ITicketDateChangePayload,
  IUpdateTicketPayload,
} from "./ticket.interface.js";

const toNumber = PostingService.toNumber;

const TICKET_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, passportNo: true } },
  supplier: { select: { id: true, name: true } },
  airline: { select: { id: true, name: true, shortCode: true, logoUrl: true } },
  route: { select: { id: true, name: true } },
} satisfies Prisma.TicketInclude;

/**
 * The money on a ticket, all of it additive.
 *
 *   customerCharge = fare + dateChangeFee − refundAmount
 *   supplierCost   = cost + dateChangeCost
 *   profit         = customerCharge − supplierCost
 *   dueAmount      = customerCharge − Σ payments
 *
 * A date change adds to both sides rather than replacing either. The
 * implementation this replaces had no date-change concept at all, and its
 * reissue path overwrote the fare while leaving cost untouched — so a reissue
 * silently inflated stored profit by the whole fare difference. Refunds there
 * were inert: recorded, then excluded from every calculation, so a refunded
 * ticket still counted its full revenue and still showed the customer owing.
 */
const computeTicketMoney = (ticket: {
  fare: Prisma.Decimal;
  cost: Prisma.Decimal;
  dateChangeFee: Prisma.Decimal | null;
  dateChangeCost: Prisma.Decimal | null;
  refundAmount: Prisma.Decimal | null;
}) => {
  const fare = toNumber(ticket.fare);
  const cost = toNumber(ticket.cost);
  const dateChangeFee = toNumber(ticket.dateChangeFee);
  const dateChangeCost = toNumber(ticket.dateChangeCost);
  const refundAmount = toNumber(ticket.refundAmount);

  const customerCharge = fare + dateChangeFee - refundAmount;
  const supplierCost = cost + dateChangeCost;

  return { customerCharge, supplierCost, profit: customerCharge - supplierCost };
};

/** Profit is stored so reports can sum it, but only ever written here. */
const persistProfit = async (client: Prisma.TransactionClient, ticketId: string) => {
  const ticket = await client.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const { profit } = computeTicketMoney(ticket);

  await client.ticket.update({
    where: { id: ticketId },
    data: { profit: new Prisma.Decimal(profit) },
  });
};

/**
 * Adds the derived money to a page of tickets with one grouped query for the
 * payments, however many rows there are. It used to run one aggregate per
 * ticket, so a 100-row page cost 100 extra queries (test/queryCount.test.ts).
 */
const decorateMany = async <T extends Parameters<typeof computeTicketMoney>[0] & { id: string }>(
  agencyId: string,
  tickets: T[],
) => {
  if (tickets.length === 0) return [];

  const paid = await prisma.ticketPayment.groupBy({
    by: ["ticketId"],
    where: { agencyId, ticketId: { in: tickets.map((ticket) => ticket.id) } },
    _sum: { amount: true },
  });
  const paidByTicket = new Map(paid.map((row) => [row.ticketId, toNumber(row._sum.amount)]));

  return tickets.map((ticket) => {
    const money = computeTicketMoney(ticket);
    const totalPaid = paidByTicket.get(ticket.id) ?? 0;
    return { ...ticket, ...money, totalPaid, dueAmount: money.customerCharge - totalPaid };
  });
};

const decorate = async <T extends Parameters<typeof computeTicketMoney>[0] & { id: string }>(
  agencyId: string,
  ticket: T,
) => (await decorateMany(agencyId, [ticket]))[0]!;

const assertReferencesBelongToAgency = async (agencyId: string, payload: Partial<ICreateTicketPayload>) => {
  if (payload.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: payload.customerId, agencyId, isDeleted: false },
    });
    if (!customer) throw new AppError(status.BAD_REQUEST, "Invalid customer for this agency");
  }
  if (payload.supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: payload.supplierId, agencyId, isDeleted: false },
    });
    if (!supplier) throw new AppError(status.BAD_REQUEST, "Invalid supplier for this agency");
  }
  if (payload.airlineId) {
    const airline = await prisma.airlineMaster.findFirst({
      where: { id: payload.airlineId, agencyId, isDeleted: false },
    });
    if (!airline) throw new AppError(status.BAD_REQUEST, "Invalid airline for this agency");
  }
  if (payload.routeId) {
    const route = await prisma.routeMaster.findFirst({
      where: { id: payload.routeId, agencyId, isDeleted: false },
    });
    if (!route) throw new AppError(status.BAD_REQUEST, "Invalid route for this agency");
  }
};

const createTicket = async (agencyId: string, payload: ICreateTicketPayload, user: IRequestUser) => {
  await assertReferencesBelongToAgency(agencyId, payload);

  const created = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        agencyId,
        customerId: payload.customerId,
        supplierId: payload.supplierId ?? null,
        airlineId: payload.airlineId ?? null,
        routeId: payload.routeId ?? null,
        passengerName: payload.passengerName,
        pnr: payload.pnr.toUpperCase(),
        travelDate: payload.travelDate ? new Date(payload.travelDate) : null,
        issueDate: payload.issueDate ? new Date(payload.issueDate) : new Date(),
        fare: new Prisma.Decimal(payload.fare),
        cost: new Prisma.Decimal(payload.cost),
        profit: new Prisma.Decimal(payload.fare - payload.cost),
        createdById: user.userId,
      },
    });

    await tx.ticketStatusHistory.create({
      data: {
        agencyId,
        ticketId: ticket.id,
        toStatus: TicketStatus.ISSUED,
        note: "Ticket issued",
        changedById: user.userId,
      },
    });

    return ticket;
  });

  return getTicketById(agencyId, created.id);
};

const getAllTickets = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>,
    Prisma.TicketWhereInput,
    Prisma.TicketInclude
  >(prisma.ticket, query, {
    searchableFields: ticketSearchableFields,
    filterableFields: ticketFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .include(TICKET_INCLUDE)
    .paginate()
    .sort()
    .fields()
    .execute();

  const decorated = await decorateMany(agencyId, result.data);

  // Agency-wide figures for the summary cards — every ticket, not just this
  // page, and not narrowed by the table's search or filters (the cards say so).
  const totals = await prisma.ticket.aggregate({
    where: { agencyId, isDeleted: false },
    _sum: { fare: true, cost: true, profit: true, dateChangeFee: true, refundAmount: true },
  });
  const paid = await prisma.ticketPayment.aggregate({
    where: { agencyId, ticket: { isDeleted: false } },
    _sum: { amount: true },
  });

  const totalCharge =
    toNumber(totals._sum.fare) + toNumber(totals._sum.dateChangeFee) - toNumber(totals._sum.refundAmount);

  return {
    ...result,
    data: decorated,
    summary: {
      totalSales: totalCharge,
      totalCost: toNumber(totals._sum.cost),
      totalProfit: toNumber(totals._sum.profit),
      totalPaid: toNumber(paid._sum.amount),
      totalDue: totalCharge - toNumber(paid._sum.amount),
    },
  };
};

const getTicketById = async (agencyId: string, id: string) => {
  const ticket = await prisma.ticket.findFirst({
    where: { id, agencyId, isDeleted: false },
    include: {
      ...TICKET_INCLUDE,
      payments: {
        include: { cashAccount: { select: { id: true, name: true } } },
        orderBy: { paidAt: "asc" },
      },
      statusHistory: { orderBy: { changedAt: "asc" } },
    },
  });

  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");
  return decorate(agencyId, ticket);
};

const updateTicket = async (agencyId: string, id: string, payload: IUpdateTicketPayload) => {
  const ticket = await prisma.ticket.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");

  await assertReferencesBelongToAgency(agencyId, payload);

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id },
      data: {
        customerId: payload.customerId,
        supplierId: payload.supplierId,
        airlineId: payload.airlineId,
        routeId: payload.routeId,
        passengerName: payload.passengerName,
        ...(payload.pnr && { pnr: payload.pnr.toUpperCase() }),
        ...(payload.travelDate && { travelDate: new Date(payload.travelDate) }),
        ...(payload.issueDate && { issueDate: new Date(payload.issueDate) }),
        ...(payload.fare !== undefined && { fare: new Prisma.Decimal(payload.fare) }),
        ...(payload.cost !== undefined && { cost: new Prisma.Decimal(payload.cost) }),
      },
    });

    // Recomputed in the service rather than by a database hook, so a plain
    // update can never leave stored profit describing older numbers.
    await persistProfit(tx, id);
  });

  return getTicketById(agencyId, id);
};

/**
 * Records a flight date change. Both sides are additive: the supplier charges
 * us, we charge the customer, and neither figure replaces the original fare or
 * cost.
 */
const recordDateChange = async (agencyId: string, id: string, payload: ITicketDateChangePayload) => {
  const ticket = await prisma.ticket.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");

  if (ticket.status === TicketStatus.REFUNDED || ticket.status === TicketStatus.VOID) {
    throw new AppError(
      status.BAD_REQUEST,
      `A ${ticket.status.toLowerCase()} ticket cannot have its date changed`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id },
      data: {
        dateChangedAt: payload.dateChangedAt ? new Date(payload.dateChangedAt) : new Date(),
        dateChangeCost: new Prisma.Decimal(payload.dateChangeCost ?? 0),
        dateChangeFee: new Prisma.Decimal(payload.dateChangeFee ?? 0),
        ...(payload.travelDate && { travelDate: new Date(payload.travelDate) }),
      },
    });

    await persistProfit(tx, id);
  });

  return getTicketById(agencyId, id);
};

/**
 * Moves a ticket through its one-way lifecycle. REFUNDED and VOID are final.
 *
 * Unlike the old implementation, a refund is not inert: the amount reduces what
 * the customer is charged, which reduces both their due and the recorded profit.
 */
const changeTicketStatus = async (
  agencyId: string,
  id: string,
  payload: IChangeTicketStatusPayload,
  user: IRequestUser,
) => {
  const ticket = await prisma.ticket.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");

  const allowed = TICKET_TRANSITIONS[ticket.status] ?? [];
  if (!allowed.includes(payload.status)) {
    throw new AppError(
      status.BAD_REQUEST,
      allowed.length > 0
        ? `Cannot change status from ${ticket.status} to ${payload.status}. Allowed: ${allowed.join(", ")}`
        : `This ticket is ${ticket.status} and cannot change status again`,
    );
  }

  if (payload.status === TicketStatus.REFUNDED && payload.refundAmount === undefined) {
    throw new AppError(status.BAD_REQUEST, "A refund amount is required when refunding a ticket");
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id },
      data: {
        status: payload.status,
        ...(payload.refundAmount !== undefined && {
          refundAmount: new Prisma.Decimal(payload.refundAmount),
        }),
      },
    });

    await tx.ticketStatusHistory.create({
      data: {
        agencyId,
        ticketId: id,
        fromStatus: ticket.status,
        toStatus: payload.status,
        note: payload.note,
        changedById: user.userId,
      },
    });

    await persistProfit(tx, id);
  });

  return getTicketById(agencyId, id);
};

/**
 * Takes money against this specific ticket and posts it to a cash account.
 *
 * Two things the old implementation got wrong, both fixed here: its
 * TicketPayment had no account at all, so money collected on a sale never
 * reached the balance sheet; and its over-payment check read the total, then
 * compared, then inserted, all outside any transaction, so two concurrent
 * payments could both pass. This is an invoice-level payment, where paying more
 * than the invoice is always an error, so it is guarded — and the guard runs
 * inside the transaction that writes the row.
 */
const recordPayment = async (
  agencyId: string,
  ticketId: string,
  payload: IRecordTicketPaymentPayload,
  user: IRequestUser,
) => {
  const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();

  await prisma.$transaction(async (tx) => {
    // First, so simultaneous payments for this ticket queue instead of each
    // summing the same total and all being allowed through. See rowLock.ts.
    await lockRow(tx, "ticket", ticketId, agencyId);

    // Re-read under the lock: the fare and any date-change fees must be the
    // committed ones, not a snapshot taken before the transaction opened.
    const ticket = await tx.ticket.findFirstOrThrow({ where: { id: ticketId, agencyId, isDeleted: false } });

    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId);

    const agg = await tx.ticketPayment.aggregate({
      where: { agencyId, ticketId },
      _sum: { amount: true },
    });
    const alreadyPaid = toNumber(agg._sum.amount);
    const { customerCharge } = computeTicketMoney(ticket);
    const due = customerCharge - alreadyPaid;

    if (payload.amount > due) {
      throw new AppError(
        status.BAD_REQUEST,
        `Cannot take more than the outstanding due of ${due.toFixed(2)}`,
      );
    }

    const payment = await tx.ticketPayment.create({
      data: {
        agencyId,
        ticketId,
        cashAccountId: payload.cashAccountId,
        amount: new Prisma.Decimal(payload.amount),
        method: payload.method,
        reference: payload.reference,
        note: payload.note,
        paidAt,
      },
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccountId,
      direction: PostingDirection.IN,
      amount: payload.amount,
      source: PostingSource.SALES_PAYMENT,
      sourceId: payment.id,
      postedAt: paidAt,
      note: payload.note,
      createdById: user.userId,
    });
  });

  return getTicketById(agencyId, ticketId);
};

const deletePayment = async (agencyId: string, ticketId: string, paymentId: string) => {
  const payment = await prisma.ticketPayment.findFirst({
    where: { id: paymentId, ticketId, agencyId },
  });
  if (!payment) throw new AppError(status.NOT_FOUND, "Payment not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, paymentId);
    await tx.ticketPayment.delete({ where: { id: paymentId } });
  });

  return getTicketById(agencyId, ticketId);
};

/**
 * Soft delete. Its payments are reversed out of the ledger first — leaving them
 * posted would keep the cash on the balance sheet for a sale that no longer
 * exists, which is what the old implementation did.
 */
const deleteTicket = async (agencyId: string, id: string) => {
  const ticket = await prisma.ticket.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!ticket) throw new AppError(status.NOT_FOUND, "Ticket not found");

  await prisma.$transaction(async (tx) => {
    const payments = await tx.ticketPayment.findMany({ where: { agencyId, ticketId: id } });
    for (const payment of payments) {
      await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, payment.id);
    }
    await tx.ticketPayment.deleteMany({ where: { agencyId, ticketId: id } });
    await tx.ticket.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  });

  return { message: "Ticket deleted successfully" };
};

export const TicketService = {
  computeTicketMoney,
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  recordDateChange,
  changeTicketStatus,
  recordPayment,
  deletePayment,
  deleteTicket,
};
