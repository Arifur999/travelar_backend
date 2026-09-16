import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { HajjBookingStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { customerFilterableFields, customerSearchableFields } from "./customer.constant.js";
import {
  ICreateCustomerPayload,
  ICustomerLedgerTotals,
  IUpdateCustomerPayload,
} from "./customer.interface.js";

const toNumber = PostingService.toNumber;

/**
 * What a customer owes:
 *
 *   currentDue = openingDue
 *              + Σ sales        (tickets, visa cases, hajj bookings)
 *              − Σ collections  (payments against those, plus due receipts)
 *              − Σ discounts
 *
 * All three sales modules contribute. The implementation this replaces counted
 * only tickets and carried a comment saying visa and hajj "will add their own
 * contributions here" — they never did, so a customer could owe thousands on a
 * visa case and still show a zero balance.
 *
 * Cancelled hajj bookings contribute nothing, matching how that module reports
 * revenue everywhere else.
 *
 * A negative figure is meaningful and allowed: the customer is in credit.
 *
 * Runs a fixed number of queries regardless of how many customers are passed,
 * so the list endpoint does not fan out per row.
 */
const attachLedgerTotals = async <T extends { id: string; openingDue: Prisma.Decimal }>(
  agencyId: string,
  customers: T[],
): Promise<(Omit<T, "openingDue"> & ICustomerLedgerTotals)[]> => {
  if (customers.length === 0) return [];

  const customerIds = customers.map((c) => c.id);

  const [tickets, visaCases, hajjBookings, ticketPayments, visaPayments, hajjPayments, dueReceipts] =
    await Promise.all([
      prisma.ticket.groupBy({
        by: ["customerId"],
        where: { agencyId, isDeleted: false, customerId: { in: customerIds } },
        // What the customer is actually charged: the fare, plus anything billed
        // for a date change, less anything refunded back to them.
        _sum: { fare: true, dateChangeFee: true, refundAmount: true },
      }),
      prisma.visaCase.groupBy({
        by: ["customerId"],
        where: { agencyId, isDeleted: false, customerId: { in: customerIds } },
        _sum: { serviceFee: true, embassyFee: true },
      }),
      prisma.hajjBooking.groupBy({
        by: ["customerId"],
        where: {
          agencyId,
          isDeleted: false,
          customerId: { in: customerIds },
          status: { not: HajjBookingStatus.CANCELLED },
        },
        _sum: { packagePrice: true },
      }),
      prisma.ticketPayment.groupBy({
        by: ["ticketId"],
        where: { agencyId, ticket: { customerId: { in: customerIds }, isDeleted: false } },
        _sum: { amount: true },
      }),
      prisma.visaPayment.groupBy({
        by: ["visaCaseId"],
        where: { agencyId, visaCase: { customerId: { in: customerIds }, isDeleted: false } },
        _sum: { amount: true },
      }),
      prisma.hajjPayment.groupBy({
        by: ["bookingId"],
        where: { agencyId, booking: { customerId: { in: customerIds }, isDeleted: false } },
        _sum: { amount: true },
      }),
      prisma.dueReceived.groupBy({
        by: ["customerId"],
        where: { agencyId, customerId: { in: customerIds } },
        _sum: { amount1: true, amount2: true, discount: true },
      }),
    ]);

  // Module payments group by their own parent id, so they have to be folded
  // back onto the customer that parent belongs to.
  const [ticketOwners, visaOwners, hajjOwners] = await Promise.all([
    prisma.ticket.findMany({
      where: { agencyId, isDeleted: false, customerId: { in: customerIds } },
      select: { id: true, customerId: true },
    }),
    prisma.visaCase.findMany({
      where: { agencyId, isDeleted: false, customerId: { in: customerIds } },
      select: { id: true, customerId: true },
    }),
    prisma.hajjBooking.findMany({
      where: { agencyId, isDeleted: false, customerId: { in: customerIds } },
      select: { id: true, customerId: true },
    }),
  ]);

  const foldByOwner = (
    owners: { id: string; customerId: string }[],
    rows: { _sum: { amount: Prisma.Decimal | null } }[],
    keyOf: (row: never) => string,
  ) => {
    const ownerOf = new Map(owners.map((o) => [o.id, o.customerId]));
    const totals = new Map<string, number>();
    for (const row of rows) {
      const customerId = ownerOf.get(keyOf(row as never));
      if (!customerId) continue;
      totals.set(customerId, (totals.get(customerId) ?? 0) + toNumber(row._sum.amount));
    }
    return totals;
  };

  const ticketSale = new Map(
    tickets.map((t) => [
      t.customerId,
      toNumber(t._sum.fare) + toNumber(t._sum.dateChangeFee) - toNumber(t._sum.refundAmount),
    ]),
  );
  const visaSale = new Map(
    visaCases.map((v) => [v.customerId, toNumber(v._sum.serviceFee) + toNumber(v._sum.embassyFee)]),
  );
  const hajjSale = new Map(hajjBookings.map((h) => [h.customerId, toNumber(h._sum.packagePrice)]));

  const ticketPaid = foldByOwner(ticketOwners, ticketPayments, (r) => (r as { ticketId: string }).ticketId);
  const visaPaid = foldByOwner(visaOwners, visaPayments, (r) => (r as { visaCaseId: string }).visaCaseId);
  const hajjPaid = foldByOwner(hajjOwners, hajjPayments, (r) => (r as { bookingId: string }).bookingId);

  const receiptMap = new Map(
    dueReceipts.map((d) => [
      d.customerId,
      {
        received: toNumber(d._sum.amount1) + toNumber(d._sum.amount2),
        discount: toNumber(d._sum.discount),
      },
    ]),
  );

  return customers.map((customer) => {
    const openingDue = toNumber(customer.openingDue);

    const totalPurchase =
      (ticketSale.get(customer.id) ?? 0) +
      (visaSale.get(customer.id) ?? 0) +
      (hajjSale.get(customer.id) ?? 0);

    const modulePayments =
      (ticketPaid.get(customer.id) ?? 0) +
      (visaPaid.get(customer.id) ?? 0) +
      (hajjPaid.get(customer.id) ?? 0);

    const receipts = receiptMap.get(customer.id) ?? { received: 0, discount: 0 };
    const collectionsAmount = modulePayments + receipts.received;

    return {
      ...customer,
      openingDue,
      totalPurchase,
      collectionsAmount,
      totalDiscount: receipts.discount,
      currentDue: openingDue + totalPurchase - collectionsAmount - receipts.discount,
    };
  });
};

const computeDue = async (agencyId: string, customerId: string) => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, agencyId, isDeleted: false },
  });
  if (!customer) throw new AppError(status.NOT_FOUND, "Customer not found");

  const [withTotals] = await attachLedgerTotals(agencyId, [customer]);
  return withTotals!;
};

const createCustomer = async (agencyId: string, payload: ICreateCustomerPayload, user: IRequestUser) => {
  const duplicate = await prisma.customer.findFirst({
    where: { agencyId, phone: payload.phone, isDeleted: false },
  });
  if (duplicate) {
    throw new AppError(status.CONFLICT, "A customer with this phone number already exists");
  }

  const customer = await prisma.customer.create({
    data: {
      agencyId,
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      passportNo: payload.passportNo,
      address: payload.address,
      note: payload.note,
      openingDue: new Prisma.Decimal(payload.openingDue ?? 0),
    },
  });

  void user;
  return computeDue(agencyId, customer.id);
};

const getAllCustomers = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.CustomerGetPayload<object>,
    Prisma.CustomerWhereInput,
    Prisma.CustomerInclude
  >(prisma.customer, query, {
    searchableFields: customerSearchableFields,
    filterableFields: customerFilterableFields,
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

const getCustomerDashboard = async (agencyId: string, sort?: string) => {
  const customers = await prisma.customer.findMany({ where: { agencyId, isDeleted: false } });
  const withTotals = await attachLedgerTotals(agencyId, customers);

  if (sort === "currentDueAsc") {
    withTotals.sort((a, b) => a.currentDue - b.currentDue);
  } else if (sort === "nameAsc") {
    withTotals.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    withTotals.sort((a, b) => b.currentDue - a.currentDue);
  }

  return {
    data: withTotals,
    summary: {
      totalCustomers: withTotals.length,
      totalOpeningDue: withTotals.reduce((sum, c) => sum + c.openingDue, 0),
      totalPurchase: withTotals.reduce((sum, c) => sum + c.totalPurchase, 0),
      totalCollections: withTotals.reduce((sum, c) => sum + c.collectionsAmount, 0),
      totalDiscount: withTotals.reduce((sum, c) => sum + c.totalDiscount, 0),
      totalCurrentDue: withTotals.reduce((sum, c) => sum + c.currentDue, 0),
    },
  };
};

const getCustomerById = async (agencyId: string, id: string) => computeDue(agencyId, id);

type LedgerRowType =
  | "opening"
  | "ticket"
  | "ticket-payment"
  | "visa"
  | "visa-payment"
  | "hajj"
  | "hajj-payment"
  | "due-received"
  | "discount";

type LedgerRow = {
  date: Date;
  type: LedgerRowType;
  description: string;
  debit: number;
  credit: number;
  runningDue: number;
};

/**
 * Chronological statement with a running due, opening balance first.
 *
 * It must end exactly on `currentDue`, so it reads the same rows with the same
 * rules as attachLedgerTotals: every non-deleted ticket, visa case and Hajj
 * booking, their payments, and due receipts. It used to list tickets only, so
 * for any customer with a visa or Hajj sale the statement stopped short of the
 * balance shown right above it. Change one of the two and the other has to
 * follow — the tripwire at the bottom logs if they ever disagree again.
 */
const getCustomerLedger = async (agencyId: string, id: string) => {
  const customer = await computeDue(agencyId, id);

  const [tickets, visaCases, hajjBookings, dueReceipts] = await Promise.all([
    prisma.ticket.findMany({
      where: { agencyId, customerId: id, isDeleted: false },
      select: {
        id: true, pnr: true, passengerName: true, fare: true, dateChangeFee: true,
        refundAmount: true, issueDate: true, createdAt: true,
        payments: { include: { cashAccount: { select: { name: true } } } },
      },
    }),
    prisma.visaCase.findMany({
      where: { agencyId, customerId: id, isDeleted: false },
      select: {
        id: true, country: true, visaType: true, applicationNo: true, serviceFee: true,
        embassyFee: true, submittedAt: true, createdAt: true,
        payments: { include: { cashAccount: { select: { name: true } } } },
      },
    }),
    prisma.hajjBooking.findMany({
      where: { agencyId, customerId: id, isDeleted: false },
      select: {
        id: true, pilgrimName: true, packagePrice: true, status: true, createdAt: true,
        hajjPackage: { select: { name: true } },
        payments: { include: { cashAccount: { select: { name: true } } } },
      },
    }),
    prisma.dueReceived.findMany({
      where: { agencyId, customerId: id },
      include: {
        cashAccount1: { select: { name: true } },
        cashAccount2: { select: { name: true } },
      },
    }),
  ]);

  const events: Omit<LedgerRow, "runningDue">[] = [];

  for (const ticket of tickets) {
    events.push({
      date: ticket.issueDate ?? ticket.createdAt,
      type: "ticket",
      description: `Ticket — PNR ${ticket.pnr}, ${ticket.passengerName}`,
      debit:
        toNumber(ticket.fare) + toNumber(ticket.dateChangeFee) - toNumber(ticket.refundAmount),
      credit: 0,
    });

    for (const payment of ticket.payments) {
      events.push({
        date: payment.paidAt,
        type: "ticket-payment",
        description: `Ticket payment — PNR ${ticket.pnr} (${payment.cashAccount.name})`,
        debit: 0,
        credit: toNumber(payment.amount),
      });
    }
  }

  for (const visaCase of visaCases) {
    const label = `${visaCase.country} ${visaCase.visaType}${
      visaCase.applicationNo ? `, #${visaCase.applicationNo}` : ""
    }`;

    events.push({
      date: visaCase.submittedAt ?? visaCase.createdAt,
      type: "visa",
      description: `Visa — ${label}`,
      debit: toNumber(visaCase.serviceFee) + toNumber(visaCase.embassyFee),
      credit: 0,
    });

    for (const payment of visaCase.payments) {
      events.push({
        date: payment.paidAt,
        type: "visa-payment",
        description: `Visa payment — ${label} (${payment.cashAccount.name})`,
        debit: 0,
        credit: toNumber(payment.amount),
      });
    }
  }

  for (const booking of hajjBookings) {
    const label = `${booking.hajjPackage.name}, ${booking.pilgrimName}`;
    const cancelled = booking.status === HajjBookingStatus.CANCELLED;

    // A cancelled booking bills nothing — the same rule the totals use — but
    // it stays on the statement so the payments taken against it still have a
    // line to belong to. Money kept from it leaves the customer in credit.
    events.push({
      date: booking.createdAt,
      type: "hajj",
      description: cancelled ? `Hajj — ${label} (cancelled, not billed)` : `Hajj — ${label}`,
      debit: cancelled ? 0 : toNumber(booking.packagePrice),
      credit: 0,
    });

    for (const payment of booking.payments) {
      events.push({
        date: payment.paidAt,
        type: "hajj-payment",
        description: `Hajj payment — ${label} (${payment.cashAccount.name})`,
        debit: 0,
        credit: toNumber(payment.amount),
      });
    }
  }

  for (const receipt of dueReceipts) {
    const accounts = [receipt.cashAccount1?.name, receipt.cashAccount2?.name].filter(Boolean).join(" + ");
    events.push({
      date: receipt.date,
      type: "due-received",
      description: `Due received — ${accounts}`,
      debit: 0,
      credit: toNumber(receipt.amount1) + toNumber(receipt.amount2),
    });

    const discount = toNumber(receipt.discount);
    if (discount > 0) {
      events.push({
        date: receipt.date,
        type: "discount",
        description: `Discount${receipt.discountCategory ? ` — ${receipt.discountCategory}` : ""}`,
        debit: 0,
        credit: discount,
      });
    }
  }

  // On the same instant a charge goes before the money against it, so the
  // running due never dips into a credit that did not really exist.
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || b.debit - a.debit);

  let running = customer.openingDue;
  const rows: LedgerRow[] = [
    {
      date: customer.createdAt,
      type: "opening",
      description: "Opening due",
      debit: customer.openingDue,
      credit: 0,
      runningDue: running,
    },
  ];

  for (const event of events) {
    running = running + event.debit - event.credit;
    rows.push({ ...event, runningDue: running });
  }

  // Tripwire: the statement and the headline figure are derived separately.
  // If a future change teaches one about a new kind of sale and not the other,
  // this says so in the logs instead of letting customers see two numbers.
  if (Math.abs(running - customer.currentDue) > 0.005) {
    logger.error("customer ledger drifted from currentDue", {
      customerId: id,
      agencyId,
      statementEndsAt: running,
      currentDue: customer.currentDue,
    });
  }

  return { customer, rows };
};

const updateCustomer = async (agencyId: string, id: string, payload: IUpdateCustomerPayload) => {
  const customer = await prisma.customer.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!customer) throw new AppError(status.NOT_FOUND, "Customer not found");

  if (payload.phone && payload.phone !== customer.phone) {
    const duplicate = await prisma.customer.findFirst({
      where: { agencyId, phone: payload.phone, isDeleted: false, id: { not: id } },
    });
    if (duplicate) {
      throw new AppError(status.CONFLICT, "A customer with this phone number already exists");
    }
  }

  await prisma.customer.update({
    where: { id },
    data: {
      name: payload.name,
      phone: payload.phone,
      email: payload.email,
      passportNo: payload.passportNo,
      address: payload.address,
      note: payload.note,
      ...(payload.openingDue !== undefined && { openingDue: new Prisma.Decimal(payload.openingDue) }),
    },
  });

  return computeDue(agencyId, id);
};

/**
 * Soft delete, refused while the customer has any history at all.
 *
 * The previous implementation only checked tickets, so a customer whose only
 * record was a due receipt could be deleted — their balance vanished from every
 * summary while the money they had paid stayed posted to a cash account.
 */
const deleteCustomer = async (agencyId: string, id: string) => {
  const customer = await prisma.customer.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!customer) throw new AppError(status.NOT_FOUND, "Customer not found");

  const [ticketCount, visaCount, hajjCount, receiptCount] = await Promise.all([
    prisma.ticket.count({ where: { agencyId, customerId: id, isDeleted: false } }),
    prisma.visaCase.count({ where: { agencyId, customerId: id, isDeleted: false } }),
    prisma.hajjBooking.count({ where: { agencyId, customerId: id, isDeleted: false } }),
    prisma.dueReceived.count({ where: { agencyId, customerId: id } }),
  ]);

  if (ticketCount > 0 || visaCount > 0 || hajjCount > 0 || receiptCount > 0) {
    throw new AppError(status.BAD_REQUEST, "This customer has history and cannot be deleted");
  }

  await prisma.customer.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  return { message: "Customer deleted successfully" };
};

export const CustomerService = {
  attachLedgerTotals,
  computeDue,
  createCustomer,
  getAllCustomers,
  getCustomerDashboard,
  getCustomerById,
  getCustomerLedger,
  updateCustomer,
  deleteCustomer,
};
