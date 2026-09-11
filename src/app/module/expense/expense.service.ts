import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { PostingDirection, PostingSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { PRESET_CATEGORY_COLORS, expenseFilterableFields, expenseSearchableFields } from "./expense.constant.js";
import {
  ICreateExpenseCategoryPayload,
  ICreateExpensePayload,
  IUpdateExpenseCategoryPayload,
  IUpdateExpensePayload,
} from "./expense.interface.js";

const toNumber = PostingService.toNumber;

const EXPENSE_INCLUDE = {
  category: { select: { id: true, name: true, color: true } },
  cashAccount: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

/* ------------------------------ categories ------------------------------ */

const assertCategoryNameFree = async (agencyId: string, name?: string, exceptId?: string) => {
  if (!name) return;
  const clash = await prisma.expenseCategory.findFirst({
    where: {
      agencyId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash) throw new AppError(status.CONFLICT, "A category with this name already exists");
};

const createCategory = async (agencyId: string, payload: ICreateExpenseCategoryPayload) => {
  await assertCategoryNameFree(agencyId, payload.name);

  // Cycle the preset palette so a new category is always visually distinct on
  // the dashboard donut without anyone having to choose a colour.
  let color = payload.color;
  if (!color) {
    const liveCount = await prisma.expenseCategory.count({ where: { agencyId, isDeleted: false } });
    color = PRESET_CATEGORY_COLORS[liveCount % PRESET_CATEGORY_COLORS.length];
  }

  return prisma.expenseCategory.create({
    data: {
      agencyId,
      name: payload.name,
      color,
      monthlyBudget: new Prisma.Decimal(payload.monthlyBudget ?? 0),
      yearlyBudget: new Prisma.Decimal(payload.yearlyBudget ?? 0),
    },
  });
};

const getAllCategories = async (agencyId: string) =>
  prisma.expenseCategory.findMany({
    where: { agencyId, isDeleted: false },
    orderBy: { createdAt: "asc" },
  });

const updateCategory = async (agencyId: string, id: string, payload: IUpdateExpenseCategoryPayload) => {
  const category = await prisma.expenseCategory.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!category) throw new AppError(status.NOT_FOUND, "Category not found");

  await assertCategoryNameFree(agencyId, payload.name, id);

  return prisma.expenseCategory.update({
    where: { id },
    data: {
      name: payload.name,
      color: payload.color,
      ...(payload.monthlyBudget !== undefined && {
        monthlyBudget: new Prisma.Decimal(payload.monthlyBudget),
      }),
      ...(payload.yearlyBudget !== undefined && {
        yearlyBudget: new Prisma.Decimal(payload.yearlyBudget),
      }),
    },
  });
};

/// Refused while expenses still reference it, and scoped by agency — the old
/// equivalent counted across every tenant, so one agency's spending could block
/// another's category from being deleted.
const deleteCategory = async (agencyId: string, id: string) => {
  const category = await prisma.expenseCategory.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!category) throw new AppError(status.NOT_FOUND, "Category not found");

  const inUse = await prisma.expense.count({ where: { agencyId, categoryId: id } });
  if (inUse > 0) {
    throw new AppError(status.BAD_REQUEST, "This category has expenses and cannot be deleted");
  }

  await prisma.expenseCategory.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  return { message: "Category deleted successfully" };
};

/* ------------------------------- expenses ------------------------------- */

const createExpense = async (agencyId: string, payload: ICreateExpensePayload, user: IRequestUser) => {
  const category = await prisma.expenseCategory.findFirst({
    where: { id: payload.categoryId, agencyId, isDeleted: false },
  });
  if (!category) throw new AppError(status.BAD_REQUEST, "Invalid expense category for this agency");

  const date = payload.date ? new Date(payload.date) : new Date();

  return prisma.$transaction(async (tx) => {
    // Checks the account belongs to this agency and is active. The old
    // implementation skipped the active check here alone, so a disabled account
    // could still be spent from.
    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId);

    const expense = await tx.expense.create({
      data: {
        agencyId,
        categoryId: payload.categoryId,
        cashAccountId: payload.cashAccountId,
        amount: new Prisma.Decimal(payload.amount),
        date,
        notes: payload.notes,
        createdById: user.userId,
      },
      include: EXPENSE_INCLUDE,
    });

    // Expenses are allowed to push an account negative — unlike a transfer,
    // that reflects how the agency already works on paper.
    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccountId,
      direction: PostingDirection.OUT,
      amount: payload.amount,
      source: PostingSource.EXPENSE,
      sourceId: expense.id,
      postedAt: date,
      note: payload.notes,
      createdById: user.userId,
    });

    return expense;
  });
};

const getAllExpenses = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.ExpenseGetPayload<{ include: typeof EXPENSE_INCLUDE }>,
    Prisma.ExpenseWhereInput,
    Prisma.ExpenseInclude
  >(prisma.expense, query, {
    searchableFields: expenseSearchableFields,
    filterableFields: expenseFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include(EXPENSE_INCLUDE)
    .paginate()
    .sort()
    .fields()
    .execute();

  const totals = await prisma.expense.aggregate({
    where: { agencyId },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    ...result,
    summary: {
      totalExpense: toNumber(totals._sum.amount),
      totalCount: totals._count._all,
    },
  };
};

const getExpenseById = async (agencyId: string, id: string) => {
  const expense = await prisma.expense.findFirst({
    where: { id, agencyId },
    include: EXPENSE_INCLUDE,
  });
  if (!expense) throw new AppError(status.NOT_FOUND, "Expense not found");
  return expense;
};

/**
 * Only the date, category and notes are editable. The amount and the account
 * have already moved a balance, so changing them in place would leave the
 * ledger describing something that never happened — delete and recreate.
 *
 * The old implementation did allow it, and compensated by hand with arithmetic
 * on a stored balance across four branches depending on whether the account had
 * changed. That is exactly the drift the posting ledger exists to prevent.
 */
const updateExpense = async (agencyId: string, id: string, payload: IUpdateExpensePayload) => {
  const existing = await prisma.expense.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Expense not found");

  if (payload.categoryId) {
    const category = await prisma.expenseCategory.findFirst({
      where: { id: payload.categoryId, agencyId, isDeleted: false },
    });
    if (!category) throw new AppError(status.BAD_REQUEST, "Invalid expense category for this agency");
  }

  const date = payload.date ? new Date(payload.date) : undefined;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.expense.update({
      where: { id },
      data: { categoryId: payload.categoryId, date, notes: payload.notes },
      include: EXPENSE_INCLUDE,
    });

    if (date) {
      await tx.accountPosting.updateMany({
        where: { source: PostingSource.EXPENSE, sourceId: id },
        data: { postedAt: date },
      });
    }

    return updated;
  });
};

const deleteExpense = async (agencyId: string, id: string) => {
  const existing = await prisma.expense.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Expense not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.EXPENSE, id);
    await tx.expense.delete({ where: { id } });
  });

  return { message: "Expense deleted successfully" };
};

/**
 * Spend per category with budget usage, aggregated in SQL.
 *
 * Totals come from the expense rows themselves rather than from the per-category
 * breakdown, so spending against a category that was later removed still counts
 * toward the agency total instead of silently disappearing from it.
 */
const getExpenseDashboard = async (agencyId: string) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const [categories, grouped, allTime, thisMonth, thisYear] = await Promise.all([
    prisma.expenseCategory.findMany({ where: { agencyId, isDeleted: false } }),
    prisma.expense.groupBy({ by: ["categoryId"], where: { agencyId }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { agencyId }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { agencyId, date: { gte: startOfMonth } }, _sum: { amount: true } }),
    prisma.expense.aggregate({ where: { agencyId, date: { gte: startOfYear } }, _sum: { amount: true } }),
  ]);

  const monthByCategory = await prisma.expense.groupBy({
    by: ["categoryId"],
    where: { agencyId, date: { gte: startOfMonth } },
    _sum: { amount: true },
  });

  const totalMap = new Map(grouped.map((g) => [g.categoryId, toNumber(g._sum.amount)]));
  const monthMap = new Map(monthByCategory.map((g) => [g.categoryId, toNumber(g._sum.amount)]));

  const totalExpenses = toNumber(allTime._sum.amount);

  const byCategory = categories.map((category) => {
    const total = totalMap.get(category.id) ?? 0;
    const month = monthMap.get(category.id) ?? 0;
    const monthlyBudget = toNumber(category.monthlyBudget);

    return {
      id: category.id,
      name: category.name,
      color: category.color,
      total,
      thisMonth: month,
      monthlyBudget,
      yearlyBudget: toNumber(category.yearlyBudget),
      percentUsedMonth: monthlyBudget > 0 ? (month / monthlyBudget) * 100 : 0,
      shareOfTotal: totalExpenses > 0 ? (total / totalExpenses) * 100 : 0,
    };
  });

  const top = byCategory.reduce<(typeof byCategory)[number] | null>(
    (best, current) => (best === null || current.total > best.total ? current : best),
    null,
  );

  return {
    totalExpenses,
    thisMonthTotal: toNumber(thisMonth._sum.amount),
    thisYearTotal: toNumber(thisYear._sum.amount),
    totalCategories: categories.length,
    byCategory: byCategory.sort((a, b) => b.total - a.total),
    topExpenseCategory: top && top.total > 0 ? top : null,
  };
};

export const ExpenseService = {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  createExpense,
  getAllExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getExpenseDashboard,
};
