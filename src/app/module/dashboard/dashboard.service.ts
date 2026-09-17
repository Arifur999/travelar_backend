import { Prisma } from "../../../generated/prisma/client.js";
import { HajjBookingStatus, PostingSource } from "../../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { PostingService } from "../cashAccount/posting.service.js";

const toNumber = PostingService.toNumber;

export interface IPeriod {
  from: Date;
  to: Date;
}

/** End of day, so a range given as two dates includes everything on the last one. */
export const endOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

/**
 * Revenue and profit for a period, across all three sales modules.
 *
 * Profit is only meaningful where a cost was recorded against the sale:
 *
 *  - Tickets carry both sides, so their stored profit is used directly.
 *  - On a visa case the embassy fee is passed through to the embassy, so the
 *    agency's margin is the service fee.
 *  - Hajj bookings record a selling price but no cost, so no profit can be
 *    derived from them. Their revenue counts; their margin is reported as null
 *    rather than silently assumed to be the whole package price.
 */
const getSalesAndProfit = async (agencyId: string, period: IPeriod) => {
  const [tickets, visaCases, hajjBookings] = await Promise.all([
    prisma.ticket.aggregate({
      where: { agencyId, isDeleted: false, issueDate: { gte: period.from, lte: period.to } },
      _sum: { fare: true, dateChangeFee: true, refundAmount: true, profit: true },
      _count: { _all: true },
    }),
    prisma.visaCase.aggregate({
      where: { agencyId, isDeleted: false, submittedAt: { gte: period.from, lte: period.to } },
      _sum: { serviceFee: true, embassyFee: true },
      _count: { _all: true },
    }),
    prisma.hajjBooking.aggregate({
      where: {
        agencyId,
        isDeleted: false,
        status: { not: HajjBookingStatus.CANCELLED },
        createdAt: { gte: period.from, lte: period.to },
      },
      _sum: { packagePrice: true },
      _count: { _all: true },
    }),
  ]);

  const ticketSales =
    toNumber(tickets._sum.fare) +
    toNumber(tickets._sum.dateChangeFee) -
    toNumber(tickets._sum.refundAmount);
  const visaSales = toNumber(visaCases._sum.serviceFee) + toNumber(visaCases._sum.embassyFee);
  const hajjSales = toNumber(hajjBookings._sum.packagePrice);

  const ticketProfit = toNumber(tickets._sum.profit);
  const visaProfit = toNumber(visaCases._sum.serviceFee);

  return {
    actualSales: ticketSales + visaSales + hajjSales,
    actualProfit: ticketProfit + visaProfit,
    byModule: {
      ticketing: { count: tickets._count._all, sales: ticketSales, profit: ticketProfit },
      visa: { count: visaCases._count._all, sales: visaSales, profit: visaProfit },
      hajj: { count: hajjBookings._count._all, sales: hajjSales, profit: null },
    },
  };
};

/// Goals are set per month, so a range sums every month it touches.
const getGoals = async (agencyId: string, period: IPeriod) => {
  const goals = await prisma.monthlyGoal.findMany({ where: { agencyId } });

  const inRange = goals.filter((goal) => {
    const monthStart = new Date(goal.year, goal.month - 1, 1);
    return monthStart >= new Date(period.from.getFullYear(), period.from.getMonth(), 1) &&
      monthStart <= period.to;
  });

  return {
    salesGoal: inRange.reduce((sum, g) => sum + toNumber(g.salesGoal), 0),
    profitGoal: inRange.reduce((sum, g) => sum + toNumber(g.profitGoal), 0),
  };
};

const getIncomeByAirline = async (agencyId: string, period: IPeriod) => {
  const grouped = await prisma.ticket.groupBy({
    by: ["airlineId"],
    where: { agencyId, isDeleted: false, issueDate: { gte: period.from, lte: period.to } },
    _sum: { fare: true, dateChangeFee: true, refundAmount: true, profit: true },
    _count: { _all: true },
  });

  const airlines = await prisma.airlineMaster.findMany({
    where: { agencyId, id: { in: grouped.map((g) => g.airlineId).filter((id): id is string => id !== null) } },
    select: { id: true, name: true, shortCode: true },
  });
  const nameOf = new Map(airlines.map((a) => [a.id, a]));

  const rows = grouped.map((row) => ({
    airlineId: row.airlineId,
    name: row.airlineId ? (nameOf.get(row.airlineId)?.name ?? "Unknown") : "Unassigned",
    shortCode: row.airlineId ? (nameOf.get(row.airlineId)?.shortCode ?? "") : "",
    count: row._count._all,
    sales:
      toNumber(row._sum.fare) + toNumber(row._sum.dateChangeFee) - toNumber(row._sum.refundAmount),
    profit: toNumber(row._sum.profit),
  }));

  const totalSales = rows.reduce((sum, r) => sum + r.sales, 0);
  const totalProfit = rows.reduce((sum, r) => sum + r.profit, 0);

  return rows
    .map((row) => ({
      ...row,
      salesShare: totalSales > 0 ? (row.sales / totalSales) * 100 : 0,
      profitShare: totalProfit !== 0 ? (row.profit / totalProfit) * 100 : 0,
    }))
    .sort((a, b) => b.sales - a.sales);
};

const getExpenseByCategory = async (agencyId: string, period: IPeriod) => {
  const grouped = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: { agencyId, date: { gte: period.from, lte: period.to } },
    _sum: { amount: true },
  });

  const categories = await prisma.expenseCategory.findMany({
    where: { agencyId, id: { in: grouped.map((g) => g.categoryId) } },
    select: { id: true, name: true, color: true },
  });
  const infoOf = new Map(categories.map((c) => [c.id, c]));

  const rows = grouped.map((row) => ({
    categoryId: row.categoryId,
    name: infoOf.get(row.categoryId)?.name ?? "Removed category",
    color: infoOf.get(row.categoryId)?.color ?? null,
    amount: toNumber(row._sum.amount),
  }));

  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  return rows
    .map((row) => ({ ...row, share: total > 0 ? (row.amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
};

/**
 * The overview the source spreadsheet shows on its Custom, Monthly and Yearly
 * dashboards — the same figures at three different scopes.
 */
const getOverview = async (agencyId: string, period: IPeriod) => {
  const [sales, goals, expenses, profitWithdrawn, incomeByAirline, expenseByCategory] =
    await Promise.all([
      getSalesAndProfit(agencyId, period),
      getGoals(agencyId, period),
      prisma.expense.aggregate({
        where: { agencyId, date: { gte: period.from, lte: period.to } },
        _sum: { amount: true },
      }),
      prisma.profitWithdrawal.aggregate({
        where: { agencyId, date: { gte: period.from, lte: period.to } },
        _sum: { amount: true },
      }),
      getIncomeByAirline(agencyId, period),
      getExpenseByCategory(agencyId, period),
    ]);

  const totalExpenses = toNumber(expenses._sum.amount);
  const profitWithdraw = toNumber(profitWithdrawn._sum.amount);
  const profitLoss = sales.actualProfit - totalExpenses;

  return {
    period: { from: period.from, to: period.to },
    salesGoal: goals.salesGoal,
    profitGoal: goals.profitGoal,
    actualSales: sales.actualSales,
    actualProfit: sales.actualProfit,
    expenses: totalExpenses,
    profitLoss,
    profitWithdraw,
    increaseOrDecrease: profitLoss - profitWithdraw,
    salesProgress: goals.salesGoal > 0 ? (sales.actualSales / goals.salesGoal) * 100 : 0,
    profitProgress: goals.profitGoal > 0 ? (sales.actualProfit / goals.profitGoal) * 100 : 0,
    byModule: sales.byModule,
    incomeByAirline,
    expenseByCategory,
  };
};

/** Month-by-month goal versus actual, for the yearly view. */
const getMonthlyBreakdown = async (agencyId: string, year: number) => {
  const months = Array.from({ length: 12 }, (_, index) => index + 1);

  return Promise.all(
    months.map(async (month) => {
      const from = new Date(year, month - 1, 1);
      const to = endOfDay(new Date(year, month, 0));

      const [sales, goals, expenses, withdrawn] = await Promise.all([
        getSalesAndProfit(agencyId, { from, to }),
        getGoals(agencyId, { from, to }),
        prisma.expense.aggregate({ where: { agencyId, date: { gte: from, lte: to } }, _sum: { amount: true } }),
        prisma.profitWithdrawal.aggregate({
          where: { agencyId, date: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
      ]);

      const totalExpenses = toNumber(expenses._sum.amount);

      return {
        year,
        month,
        monthName: from.toLocaleString("en-US", { month: "long" }),
        salesGoal: goals.salesGoal,
        actualSales: sales.actualSales,
        profitGoal: goals.profitGoal,
        actualProfit: sales.actualProfit,
        expenses: totalExpenses,
        profitLoss: sales.actualProfit - totalExpenses,
        profitWithdraw: toNumber(withdrawn._sum.amount),
      };
    }),
  );
};

/**
 * Where the money currently stands, reconciled the way the spreadsheet's Cash
 * Flow tab does it: what is in the accounts, plus what customers still owe,
 * less what is still owed to suppliers.
 */
const getCashFlow = async (agencyId: string) => {
  const [balances, capital] = await Promise.all([
    PostingService.getBalances(agencyId),
    prisma.accountPosting.groupBy({
      by: ["source"],
      where: {
        agencyId,
        source: { in: [PostingSource.INVESTMENT, PostingSource.INVESTMENT_WITHDRAWAL] },
      },
      _sum: { amount: true },
    }),
  ]);

  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({ where: { agencyId, isDeleted: false }, select: { id: true, openingDue: true } }),
    prisma.supplier.findMany({ where: { agencyId, isDeleted: false }, select: { id: true, openingPayable: true } }),
  ]);

  const { CustomerService } = await import("../customer/customer.service.js");
  const { SupplierService } = await import("../supplier/supplier.service.js");

  const [customerTotals, supplierTotals] = await Promise.all([
    CustomerService.attachLedgerTotals(agencyId, customers),
    SupplierService.attachLedgerTotals(agencyId, suppliers),
  ]);

  const accountBalance = balances.reduce((sum, a) => sum + a.currentBalance, 0);
  const customerDue = customerTotals.reduce((sum, c) => sum + c.currentDue, 0);
  const supplierPayable = supplierTotals.reduce((sum, s) => sum + s.currentPayable, 0);

  const invested = toNumber(capital.find((c) => c.source === PostingSource.INVESTMENT)?._sum.amount);
  const withdrawn = toNumber(
    capital.find((c) => c.source === PostingSource.INVESTMENT_WITHDRAWAL)?._sum.amount,
  );

  const totalAssets = accountBalance + customerDue;
  const netCashFlow = totalAssets - supplierPayable;
  const netInvestment = invested - withdrawn;

  return {
    /// Each account's share of accountBalance, largest first. Inactive accounts
    /// are included: money sitting in one is still the agency's money.
    accounts: balances
      .map((account) => ({
        id: account.id,
        name: account.name,
        category: account.category,
        isActive: account.isActive,
        balance: account.currentBalance,
      }))
      .sort((a, b) => b.balance - a.balance),
    accountBalance,
    customerDue,
    totalAssets,
    supplierPayable,
    netCashFlow,
    invested,
    withdrawn,
    netInvestment,
    /// What the business has generated beyond what the owners put in.
    difference: netCashFlow - netInvestment,
  };
};

/**
 * Sales, profit and expenses for the last `count` calendar months, oldest
 * first, the current month included (to date).
 *
 * A rolling window rather than the calendar year: in January a year-to-date
 * chart would be one bar. Each month goes through getSalesAndProfit, the same
 * function every other view uses, so the landing chart can never disagree with
 * the Reports page about what a month's profit was — that costs four small
 * indexed aggregates per month, which is the right trade for one definition.
 */
const getRecentMonths = async (agencyId: string, count: number, now = new Date()) => {
  const months = Array.from({ length: count }, (_, index) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    const isCurrent = index === count - 1;
    return {
      from: start,
      to: isCurrent ? endOfDay(now) : endOfDay(new Date(start.getFullYear(), start.getMonth() + 1, 0)),
    };
  });

  return Promise.all(
    months.map(async ({ from, to }) => {
      const [sales, expenses] = await Promise.all([
        getSalesAndProfit(agencyId, { from, to }),
        prisma.expense.aggregate({ where: { agencyId, date: { gte: from, lte: to } }, _sum: { amount: true } }),
      ]);

      return {
        year: from.getFullYear(),
        month: from.getMonth() + 1,
        sales: sales.actualSales,
        profit: sales.actualProfit,
        expenses: toNumber(expenses._sum.amount),
      };
    }),
  );
};

/** How many months the landing trend covers. */
export const SUMMARY_TREND_MONTHS = 6;

/**
 * Headline figures for the landing dashboard.
 *
 * This is a base feature, served to every plan. It is deliberately a fixed,
 * short view — this month, the current cash position and a six-month trend.
 * Custom ranges, whole years and month-by-month goal tables stay behind the
 * REPORTS feature.
 */
const getSummary = async (agencyId: string) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = endOfDay(now);

  const [overview, cashFlow, trend] = await Promise.all([
    getOverview(agencyId, { from, to }),
    getCashFlow(agencyId),
    getRecentMonths(agencyId, SUMMARY_TREND_MONTHS, now),
  ]);

  return { thisMonth: overview, cashFlow, trend };
};

/* --------------------------------- goals -------------------------------- */

const upsertGoal = async (
  agencyId: string,
  payload: { year: number; month: number; salesGoal?: number; profitGoal?: number },
) => {
  return prisma.monthlyGoal.upsert({
    where: { agencyId_year_month: { agencyId, year: payload.year, month: payload.month } },
    create: {
      agencyId,
      year: payload.year,
      month: payload.month,
      salesGoal: new Prisma.Decimal(payload.salesGoal ?? 0),
      profitGoal: new Prisma.Decimal(payload.profitGoal ?? 0),
    },
    update: {
      ...(payload.salesGoal !== undefined && { salesGoal: new Prisma.Decimal(payload.salesGoal) }),
      ...(payload.profitGoal !== undefined && { profitGoal: new Prisma.Decimal(payload.profitGoal) }),
    },
  });
};

const getGoalsForYear = async (agencyId: string, year: number) =>
  prisma.monthlyGoal.findMany({ where: { agencyId, year }, orderBy: { month: "asc" } });

export const DashboardService = {
  getOverview,
  getMonthlyBreakdown,
  getCashFlow,
  getRecentMonths,
  getSummary,
  upsertGoal,
  getGoalsForYear,
  endOfDay,
};
