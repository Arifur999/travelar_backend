import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  AttendanceStatus,
  EmployeePayoutType,
  PostingDirection,
  PostingSource,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { calcTotalHours, calcWorkingDuration, startOfDayUtc } from "./employee.utils.js";
import {
  ICreateAttendancePayload,
  ICreateEmployeePayload,
  ICreateEmployeeTransactionPayload,
  IUpdateEmployeePayload,
} from "./employee.interface.js";

const toNumber = PostingService.toNumber;

/**
 * Whether someone still works here is decided by one thing — do they have a
 * resign date. There is no separate isActive column to drift out of step with
 * it, which is what the old model kept in sync with a save hook.
 */
const withDerived = <T extends { joinDate: Date; resignDate: Date | null }>(employee: T) => ({
  ...employee,
  isActive: employee.resignDate === null,
  ...calcWorkingDuration(employee.joinDate, employee.resignDate),
});

const attachPayoutTotals = async <T extends { id: string; joinDate: Date; resignDate: Date | null }>(
  agencyId: string,
  employees: T[],
) => {
  if (employees.length === 0) return [];

  const grouped = await prisma.employeeTransaction.groupBy({
    by: ["employeeId", "type"],
    where: { agencyId, employeeId: { in: employees.map((e) => e.id) } },
    _sum: { amount: true },
  });

  const totals = new Map<string, { salary: number; bonus: number }>();
  for (const row of grouped) {
    const entry = totals.get(row.employeeId) ?? { salary: 0, bonus: 0 };
    if (row.type === EmployeePayoutType.SALARY) entry.salary = toNumber(row._sum.amount);
    else entry.bonus = toNumber(row._sum.amount);
    totals.set(row.employeeId, entry);
  }

  return employees.map((employee) => {
    const { salary, bonus } = totals.get(employee.id) ?? { salary: 0, bonus: 0 };
    return { ...withDerived(employee), totalSalary: salary, totalBonus: bonus, subtotal: salary + bonus };
  });
};

const assertDatesMakeSense = (joinDate: Date, resignDate?: Date | null) => {
  if (resignDate && resignDate < joinDate) {
    throw new AppError(status.BAD_REQUEST, "Resign date cannot be before the join date");
  }
};

const createEmployee = async (agencyId: string, payload: ICreateEmployeePayload, user: IRequestUser) => {
  const joinDate = new Date(payload.joinDate);
  const resignDate = payload.resignDate ? new Date(payload.resignDate) : null;
  assertDatesMakeSense(joinDate, resignDate);

  const employee = await prisma.employee.create({
    data: {
      agencyId,
      name: payload.name,
      phone: payload.phone,
      address: payload.address,
      joinDate,
      resignDate,
      createdById: user.userId,
    },
  });

  return withDerived(employee);
};

const getAllEmployees = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.EmployeeGetPayload<object>,
    Prisma.EmployeeWhereInput,
    Prisma.EmployeeInclude
  >(prisma.employee, query, {
    searchableFields: ["name", "phone", "address"],
    filterableFields: ["name", "phone"],
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .paginate()
    .sort()
    .fields()
    .execute();

  const [activeCount, totalCount] = await Promise.all([
    prisma.employee.count({ where: { agencyId, isDeleted: false, resignDate: null } }),
    prisma.employee.count({ where: { agencyId, isDeleted: false } }),
  ]);

  return {
    ...result,
    data: await attachPayoutTotals(agencyId, result.data),
    summary: { activeCount, totalCount, resignedCount: totalCount - activeCount },
  };
};

const getEmployeeDashboard = async (agencyId: string) => {
  const employees = await prisma.employee.findMany({ where: { agencyId, isDeleted: false } });
  const withTotals = await attachPayoutTotals(agencyId, employees);

  return {
    data: withTotals.sort((a, b) => b.subtotal - a.subtotal),
    summary: {
      totalEmployees: withTotals.length,
      activeCount: withTotals.filter((e) => e.isActive).length,
      resignedCount: withTotals.filter((e) => !e.isActive).length,
      totalSalary: withTotals.reduce((sum, e) => sum + e.totalSalary, 0),
      totalBonus: withTotals.reduce((sum, e) => sum + e.totalBonus, 0),
    },
  };
};

const getEmployeeById = async (agencyId: string, id: string) => {
  const employee = await prisma.employee.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!employee) throw new AppError(status.NOT_FOUND, "Employee not found");

  const [withTotals] = await attachPayoutTotals(agencyId, [employee]);
  return withTotals;
};

const updateEmployee = async (agencyId: string, id: string, payload: IUpdateEmployeePayload) => {
  const employee = await prisma.employee.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!employee) throw new AppError(status.NOT_FOUND, "Employee not found");

  const joinDate = payload.joinDate ? new Date(payload.joinDate) : employee.joinDate;
  const resignDate =
    payload.resignDate === null
      ? null
      : payload.resignDate
        ? new Date(payload.resignDate)
        : employee.resignDate;

  assertDatesMakeSense(joinDate, resignDate);

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      name: payload.name,
      phone: payload.phone,
      address: payload.address,
      joinDate,
      resignDate,
    },
  });

  return withDerived(updated);
};

/// Refused while any payout or attendance history exists.
const deleteEmployee = async (agencyId: string, id: string) => {
  const employee = await prisma.employee.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!employee) throw new AppError(status.NOT_FOUND, "Employee not found");

  const [payouts, attendance] = await Promise.all([
    prisma.employeeTransaction.count({ where: { agencyId, employeeId: id } }),
    prisma.employeeAttendance.count({ where: { agencyId, employeeId: id } }),
  ]);

  if (payouts > 0 || attendance > 0) {
    throw new AppError(
      status.BAD_REQUEST,
      "This employee has payout or attendance history and cannot be deleted",
    );
  }

  await prisma.employee.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  return { message: "Employee deleted successfully" };
};

/* -------------------------------- payouts ------------------------------- */

const createTransaction = async (
  agencyId: string,
  payload: ICreateEmployeeTransactionPayload,
  user: IRequestUser,
) => {
  const employee = await prisma.employee.findFirst({
    where: { id: payload.employeeId, agencyId, isDeleted: false },
  });
  if (!employee) throw new AppError(status.BAD_REQUEST, "Invalid employee for this agency");

  const date = payload.date ? new Date(payload.date) : new Date();

  return prisma.$transaction(async (tx) => {
    await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId);

    const transaction = await tx.employeeTransaction.create({
      data: {
        agencyId,
        employeeId: payload.employeeId,
        cashAccountId: payload.cashAccountId,
        type: payload.type,
        amount: new Prisma.Decimal(payload.amount),
        date,
        // Only meaningful on a salary. A bonus covers no days, and the old
        // update path set this regardless of type.
        totalDays: payload.type === EmployeePayoutType.SALARY ? payload.totalDays : null,
        note: payload.note,
        createdById: user.userId,
      },
      include: {
        employee: { select: { id: true, name: true, phone: true } },
        cashAccount: { select: { id: true, name: true } },
      },
    });

    await PostingService.post(tx, {
      agencyId,
      cashAccountId: payload.cashAccountId,
      direction: PostingDirection.OUT,
      amount: payload.amount,
      source: PostingSource.EMPLOYEE_PAYOUT,
      sourceId: transaction.id,
      postedAt: date,
      note: payload.note,
      createdById: user.userId,
    });

    return transaction;
  });
};

const getAllTransactions = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.EmployeeTransactionGetPayload<object>,
    Prisma.EmployeeTransactionWhereInput,
    Prisma.EmployeeTransactionInclude
  >(prisma.employeeTransaction, query, {
    searchableFields: ["note", "employee.name", "employee.phone", "cashAccount.name"],
    filterableFields: ["employeeId", "type", "cashAccountId", "date"],
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include({
      employee: { select: { id: true, name: true, phone: true } },
      cashAccount: { select: { id: true, name: true } },
    })
    .paginate()
    .sort()
    .fields()
    .execute();

  const grouped = await prisma.employeeTransaction.groupBy({
    by: ["type"],
    where: { agencyId },
    _sum: { amount: true },
  });

  const totalSalary = toNumber(grouped.find((g) => g.type === EmployeePayoutType.SALARY)?._sum.amount);
  const totalBonus = toNumber(grouped.find((g) => g.type === EmployeePayoutType.BONUS)?._sum.amount);

  return { ...result, summary: { totalSalary, totalBonus, subtotal: totalSalary + totalBonus } };
};

const deleteTransaction = async (agencyId: string, id: string) => {
  const existing = await prisma.employeeTransaction.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Payout not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.EMPLOYEE_PAYOUT, id);
    await tx.employeeTransaction.delete({ where: { id } });
  });

  return { message: "Payout deleted successfully" };
};

/* ------------------------------ attendance ------------------------------ */

const createAttendance = async (agencyId: string, payload: ICreateAttendancePayload, user: IRequestUser) => {
  const employee = await prisma.employee.findFirst({
    where: { id: payload.employeeId, agencyId, isDeleted: false },
  });
  if (!employee) throw new AppError(status.BAD_REQUEST, "Invalid employee for this agency");

  // A calendar day, normalised in UTC so the write and the read agree. The old
  // code normalised with local setHours and then filtered with a UTC string.
  const date = startOfDayUtc(payload.date);

  const clash = await prisma.employeeAttendance.findFirst({
    where: { employeeId: payload.employeeId, date },
  });
  if (clash) {
    throw new AppError(status.CONFLICT, "Attendance for this employee on this date already exists");
  }

  return prisma.employeeAttendance.create({
    data: {
      agencyId,
      employeeId: payload.employeeId,
      date,
      status: payload.status,
      startTime: payload.startTime,
      endTime: payload.endTime,
      totalHours: new Prisma.Decimal(calcTotalHours(payload.startTime, payload.endTime) ?? 0),
      note: payload.note,
      createdById: user.userId,
    },
    include: { employee: { select: { id: true, name: true, phone: true } } },
  });
};

const getAllAttendance = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.EmployeeAttendanceGetPayload<object>,
    Prisma.EmployeeAttendanceWhereInput,
    Prisma.EmployeeAttendanceInclude
  >(prisma.employeeAttendance, query, {
    searchableFields: ["note", "employee.name", "employee.phone"],
    filterableFields: ["employeeId", "status", "date"],
  });

  return queryBuilder
    .search()
    .filter()
    .where({ agencyId })
    .include({ employee: { select: { id: true, name: true, phone: true } } })
    .paginate()
    .sort()
    .fields()
    .execute();
};

/**
 * Present and absent counts, plus how many distinct days have any record.
 *
 * `daysRecorded` is deliberately named for what it measures — the old field was
 * called totalDays while counting distinct dates across every employee at once,
 * which reads as per-person working days and is not.
 */
const getAttendanceSummary = async (agencyId: string, employeeId?: string) => {
  const where: Prisma.EmployeeAttendanceWhereInput = { agencyId, ...(employeeId ? { employeeId } : {}) };

  const [byStatus, distinctDates] = await Promise.all([
    prisma.employeeAttendance.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.employeeAttendance.findMany({ where, select: { date: true }, distinct: ["date"] }),
  ]);

  return {
    presentCount: byStatus.find((s) => s.status === AttendanceStatus.PRESENT)?._count._all ?? 0,
    absentCount: byStatus.find((s) => s.status === AttendanceStatus.ABSENT)?._count._all ?? 0,
    daysRecorded: distinctDates.length,
  };
};

const deleteAttendance = async (agencyId: string, id: string) => {
  const existing = await prisma.employeeAttendance.findFirst({ where: { id, agencyId } });
  if (!existing) throw new AppError(status.NOT_FOUND, "Attendance entry not found");

  await prisma.employeeAttendance.delete({ where: { id } });
  return { message: "Attendance entry deleted successfully" };
};

export const EmployeeService = {
  createEmployee,
  getAllEmployees,
  getEmployeeDashboard,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  createTransaction,
  getAllTransactions,
  deleteTransaction,
  createAttendance,
  getAllAttendance,
  getAttendanceSummary,
  deleteAttendance,
};
