import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { PostingService } from "../cashAccount/posting.service.js";
import {
  IWalletHolder,
  IWalletMovement,
  IWalletStatement,
  IWalletSummary,
} from "./wallet.interface.js";

const toNumber = PostingService.toNumber;
type Tx = Prisma.TransactionClient;

/**
 * What a customer has paid in that no invoice has consumed yet — their wallet.
 *
 *   balance = Σ money received on collections
 *           − Σ payments settled from the wallet
 *
 * There is deliberately no wallet table. The money is already recorded: a
 * deposit is an ordinary collection, and spending it is an ordinary payment
 * carrying `fromWallet`. A second ledger holding the same figure is a second
 * figure to disagree with the first — the same reason a cash account has no
 * stored balance here.
 *
 * Note what this is not: it is not "what the customer is owed". A customer can
 * hold a wallet balance and still have an unpaid invoice — the agency simply
 * has not applied one to the other yet. What they owe overall stays
 * `currentDue` on the customer.
 */
const balanceOf = async (agencyId: string, customerId: string, client: Tx | typeof prisma = prisma) => {
  const [received, spent] = await Promise.all([
    client.dueReceived.aggregate({
      where: { agencyId, customerId },
      _sum: { amount1: true, amount2: true },
    }),
    Promise.all([
      client.ticketPayment.aggregate({
        where: { agencyId, fromWallet: true, ticket: { customerId } },
        _sum: { amount: true },
      }),
      client.visaPayment.aggregate({
        where: { agencyId, fromWallet: true, visaCase: { customerId } },
        _sum: { amount: true },
      }),
      client.hajjPayment.aggregate({
        where: { agencyId, fromWallet: true, booking: { customerId } },
        _sum: { amount: true },
      }),
    ]),
  ]);

  const paidIn = toNumber(received._sum.amount1) + toNumber(received._sum.amount2);
  const usedUp = spent.reduce((sum, row) => sum + toNumber(row._sum.amount), 0);

  return { paidIn, usedUp, balance: paidIn - usedUp };
};

/**
 * Refuses a payment the wallet cannot cover.
 *
 * MUST run inside the caller's transaction, after `lockRow(tx, "customer", …)`:
 * it sums rows and then decides, which without the lock lets two simultaneous
 * payments both pass and overdraw the wallet. See rowLock.ts for why the
 * customer is locked before the ticket, case or booking.
 */
const assertCovers = async (tx: Tx, agencyId: string, customerId: string, amount: number) => {
  const { balance } = await balanceOf(agencyId, customerId, tx);

  if (amount > balance) {
    throw new AppError(
      status.BAD_REQUEST,
      balance <= 0
        ? "This customer has nothing paid in advance to settle from"
        : `Only ${balance.toFixed(2)} is available from what this customer paid in advance`,
    );
  }

  return balance;
};

/**
 * Every customer holding a balance, largest first.
 *
 * Three aggregates and one lookup, whatever the number of customers — the same
 * rule the customer list follows, so this cannot fan out per row.
 */
const getHolders = async (agencyId: string): Promise<IWalletHolder[]> => {
  const [receipts, ticketSpend, visaSpend, hajjSpend] = await Promise.all([
    prisma.dueReceived.groupBy({
      by: ["customerId"],
      where: { agencyId },
      _sum: { amount1: true, amount2: true },
    }),
    prisma.ticketPayment.findMany({
      where: { agencyId, fromWallet: true },
      select: { amount: true, ticket: { select: { customerId: true } } },
    }),
    prisma.visaPayment.findMany({
      where: { agencyId, fromWallet: true },
      select: { amount: true, visaCase: { select: { customerId: true } } },
    }),
    prisma.hajjPayment.findMany({
      where: { agencyId, fromWallet: true },
      select: { amount: true, booking: { select: { customerId: true } } },
    }),
  ]);

  const paidIn = new Map<string, number>();
  for (const row of receipts) {
    paidIn.set(row.customerId, toNumber(row._sum.amount1) + toNumber(row._sum.amount2));
  }

  const usedUp = new Map<string, number>();
  const addSpend = (customerId: string, amount: Prisma.Decimal) => {
    usedUp.set(customerId, (usedUp.get(customerId) ?? 0) + toNumber(amount));
  };
  for (const row of ticketSpend) addSpend(row.ticket.customerId, row.amount);
  for (const row of visaSpend) addSpend(row.visaCase.customerId, row.amount);
  for (const row of hajjSpend) addSpend(row.booking.customerId, row.amount);

  const customerIds = [...new Set([...paidIn.keys(), ...usedUp.keys()])];
  if (customerIds.length === 0) return [];

  const customers = await prisma.customer.findMany({
    where: { agencyId, id: { in: customerIds }, isDeleted: false },
    select: { id: true, name: true, phone: true },
  });

  return customers
    .map((customer) => {
      const paid = paidIn.get(customer.id) ?? 0;
      const used = usedUp.get(customer.id) ?? 0;
      return {
        customerId: customer.id,
        name: customer.name,
        phone: customer.phone,
        paidIn: paid,
        usedUp: used,
        balance: paid - used,
      };
    })
    .filter((holder) => holder.balance > 0.005)
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
};

const getSummary = async (agencyId: string): Promise<IWalletSummary> => {
  const holders = await getHolders(agencyId);

  return {
    totalHeld: holders.reduce((sum, holder) => sum + holder.balance, 0),
    customersInCredit: holders.length,
    paidIn: holders.reduce((sum, holder) => sum + holder.paidIn, 0),
    usedUp: holders.reduce((sum, holder) => sum + holder.usedUp, 0),
  };
};

/** One customer's wallet, oldest movement first, with a running balance. */
const getStatement = async (agencyId: string, customerId: string): Promise<IWalletStatement> => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, agencyId, isDeleted: false },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) throw new AppError(status.NOT_FOUND, "Customer not found");

  const [receipts, ticketSpend, visaSpend, hajjSpend] = await Promise.all([
    prisma.dueReceived.findMany({
      where: { agencyId, customerId },
      include: {
        cashAccount1: { select: { name: true } },
        cashAccount2: { select: { name: true } },
      },
    }),
    prisma.ticketPayment.findMany({
      where: { agencyId, fromWallet: true, ticket: { customerId } },
      select: { id: true, amount: true, paidAt: true, ticket: { select: { pnr: true } } },
    }),
    prisma.visaPayment.findMany({
      where: { agencyId, fromWallet: true, visaCase: { customerId } },
      select: {
        id: true,
        amount: true,
        paidAt: true,
        visaCase: { select: { country: true, visaType: true } },
      },
    }),
    prisma.hajjPayment.findMany({
      where: { agencyId, fromWallet: true, booking: { customerId } },
      select: { id: true, amount: true, paidAt: true, booking: { select: { pilgrimName: true } } },
    }),
  ]);

  const movements = [
    ...receipts.map((receipt) => {
      const accounts = [receipt.cashAccount1?.name, receipt.cashAccount2?.name]
        .filter(Boolean)
        .join(" + ");
      return {
        id: receipt.id,
        date: receipt.date,
        type: "PAID_IN" as const,
        description: accounts ? `Paid in (${accounts})` : "Paid in",
        amount: toNumber(receipt.amount1) + toNumber(receipt.amount2),
      };
    }),
    ...ticketSpend.map((payment) => ({
      id: payment.id,
      date: payment.paidAt,
      type: "SPENT" as const,
      description: `Ticket — PNR ${payment.ticket.pnr}`,
      amount: toNumber(payment.amount),
    })),
    ...visaSpend.map((payment) => ({
      id: payment.id,
      date: payment.paidAt,
      type: "SPENT" as const,
      description: `Visa — ${payment.visaCase.country} ${payment.visaCase.visaType}`,
      amount: toNumber(payment.amount),
    })),
    ...hajjSpend.map((payment) => ({
      id: payment.id,
      date: payment.paidAt,
      type: "SPENT" as const,
      description: `Hajj & Umrah — ${payment.booking.pilgrimName}`,
      amount: toNumber(payment.amount),
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  let running = 0;
  const withBalance: IWalletMovement[] = movements.map((movement) => {
    running += movement.type === "PAID_IN" ? movement.amount : -movement.amount;
    return { ...movement, date: movement.date.toISOString(), balance: running };
  });

  const paidIn = movements
    .filter((movement) => movement.type === "PAID_IN")
    .reduce((sum, movement) => sum + movement.amount, 0);

  return {
    customer,
    paidIn,
    usedUp: paidIn - running,
    balance: running,
    movements: withBalance,
  };
};

export const WalletService = {
  balanceOf,
  assertCovers,
  getHolders,
  getSummary,
  getStatement,
};
