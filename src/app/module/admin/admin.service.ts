import status from "http-status";
import { addDays } from "date-fns";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  AgencyStatus,
  PlanFeature,
  PlanHistoryAction,
  SubscriptionOrderStatus,
  UserStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { BillingService } from "../billing/billing.service.js";
import { AgencyLifecycleService } from "../agency/agencyLifecycle.service.js";
import { logger } from "../../lib/logger.js";

const toNumber = PostingService.toNumber;

const logActivity = async (
  adminId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Prisma.InputJsonValue = {},
) => {
  // Fire and forget — an audit failure must never break the action it records.
  try {
    await prisma.adminActivityLog.create({ data: { adminId, action, targetType, targetId, details } });
  } catch (error) {
    logger.error("activity log write failed", { action, targetType, targetId, err: error });
  }
};

/* --------------------------------- plans -------------------------------- */

interface IPlanPayload {
  name?: string;
  description?: string;
  price?: number;
  durationDays?: number;
  features?: PlanFeature[];
  isActive?: boolean;
}

const createPlan = async (payload: IPlanPayload, user: IRequestUser) => {
  const clash = await prisma.plan.findFirst({
    where: { name: { equals: payload.name, mode: "insensitive" }, isDeleted: false },
  });
  if (clash) throw new AppError(status.CONFLICT, "A plan with this name already exists");

  const plan = await prisma.plan.create({
    data: {
      name: payload.name as string,
      description: payload.description,
      price: new Prisma.Decimal(payload.price ?? 0),
      durationDays: payload.durationDays ?? 30,
      features: payload.features ?? [],
      isActive: payload.isActive ?? true,
    },
  });

  await logActivity(user.userId, "plan_created", "Plan", plan.id, {
    name: plan.name,
    price: toNumber(plan.price),
  });

  return { ...plan, price: toNumber(plan.price) };
};

const listPlans = async () => {
  const plans = await prisma.plan.findMany({ where: { isDeleted: false }, orderBy: { price: "asc" } });

  const counts = await prisma.agency.groupBy({
    by: ["planId"],
    where: { isDeleted: false, planId: { not: null } },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.planId, c._count._all]));

  return plans.map((plan) => ({
    ...plan,
    price: toNumber(plan.price),
    agencyCount: countOf.get(plan.id) ?? 0,
  }));
};

const updatePlan = async (id: string, payload: IPlanPayload, user: IRequestUser) => {
  const plan = await prisma.plan.findFirst({ where: { id, isDeleted: false } });
  if (!plan) throw new AppError(status.NOT_FOUND, "Plan not found");

  if (payload.name && payload.name.toLowerCase() !== plan.name.toLowerCase()) {
    const clash = await prisma.plan.findFirst({
      where: { name: { equals: payload.name, mode: "insensitive" }, isDeleted: false, id: { not: id } },
    });
    if (clash) throw new AppError(status.CONFLICT, "A plan with this name already exists");
  }

  const updated = await prisma.plan.update({
    where: { id },
    data: {
      name: payload.name,
      description: payload.description,
      ...(payload.price !== undefined && { price: new Prisma.Decimal(payload.price) }),
      durationDays: payload.durationDays,
      features: payload.features,
      isActive: payload.isActive,
    },
  });

  await logActivity(user.userId, "plan_updated", "Plan", id, { name: updated.name });
  return { ...updated, price: toNumber(updated.price) };
};

/// Deactivates rather than removes — agencies may still be on it, and their
/// history has to keep resolving.
const deactivatePlan = async (id: string, user: IRequestUser) => {
  const plan = await prisma.plan.findFirst({ where: { id, isDeleted: false } });
  if (!plan) throw new AppError(status.NOT_FOUND, "Plan not found");

  await prisma.plan.update({ where: { id }, data: { isActive: false } });
  await logActivity(user.userId, "plan_deactivated", "Plan", id, { name: plan.name });

  return { message: "Plan deactivated successfully" };
};

/* ------------------------------- agencies ------------------------------- */

const listAgencies = async (query: IqueryParams) => {
  // Statuses are fixed before reading, so a status filter or badge is never
  // stale between runs of the hourly lifecycle job.
  await AgencyLifecycleService.expireLapsedAgencies();

  const queryBuilder = new QueryBuilder<
    Prisma.AgencyGetPayload<object>,
    Prisma.AgencyWhereInput,
    Prisma.AgencyInclude
  >(prisma.agency, query, {
    searchableFields: ["name", "email", "phone"],
    filterableFields: ["status", "planId"],
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ isDeleted: false })
    .include({ plan: { select: { id: true, name: true } } })
    .paginate()
    .sort()
    .fields()
    .execute();

  return result;
};

const getAgencyById = async (id: string) => {
  await AgencyLifecycleService.expireLapsedAgencies();

  const agency = await prisma.agency.findFirst({
    where: { id, isDeleted: false },
    include: {
      plan: true,
      users: {
        where: { isDeleted: false },
        select: { id: true, name: true, email: true, role: true, status: true },
      },
      planHistories: {
        include: { plan: { select: { id: true, name: true } } },
        orderBy: { assignedAt: "desc" },
      },
    },
  });

  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");
  return agency;
};

const updateAgencyStatus = async (id: string, agencyStatus: AgencyStatus, user: IRequestUser) => {
  const agency = await prisma.agency.findFirst({ where: { id, isDeleted: false } });
  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");

  await prisma.agency.update({ where: { id }, data: { status: agencyStatus } });
  await logActivity(user.userId, "agency_status_changed", "Agency", id, {
    from: agency.status,
    to: agencyStatus,
  });

  return { message: `Agency marked ${agencyStatus.toLowerCase()}` };
};

/// Assigning a plan by hand uses the same stacking renewal as a payment, so the
/// two paths cannot disagree about what a subscription end date means.
const assignPlan = async (id: string, planId: string, user: IRequestUser) => {
  const [agency, plan] = await Promise.all([
    prisma.agency.findFirst({ where: { id, isDeleted: false }, include: { plan: true } }),
    prisma.plan.findFirst({ where: { id: planId, isDeleted: false } }),
  ]);

  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");
  if (!plan) throw new AppError(status.BAD_REQUEST, "Plan not found");

  const action = !agency.plan
    ? PlanHistoryAction.ASSIGNED
    : toNumber(plan.price) > toNumber(agency.plan.price)
      ? PlanHistoryAction.UPGRADED
      : toNumber(plan.price) < toNumber(agency.plan.price)
        ? PlanHistoryAction.DOWNGRADED
        : PlanHistoryAction.ASSIGNED;

  await prisma.$transaction(async (tx) => {
    await BillingService.renewSubscription(tx, id, planId, plan.durationDays, user.userId, action);
  });

  await logActivity(user.userId, "plan_assigned", "Agency", id, { planId, planName: plan.name, action });
  return { message: "Plan assigned successfully" };
};

const extendTrial = async (id: string, days: number, user: IRequestUser) => {
  const agency = await prisma.agency.findFirst({ where: { id, isDeleted: false } });
  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");

  const base =
    agency.trialEndsAt && agency.trialEndsAt.getTime() > Date.now() ? agency.trialEndsAt : new Date();

  await prisma.$transaction(async (tx) => {
    await tx.agency.update({
      where: { id },
      data: {
        trialEndsAt: addDays(base, days),
        // Only an expired agency goes back to trial; an active paying one keeps
        // its subscription.
        ...(agency.status === AgencyStatus.EXPIRED ? { status: AgencyStatus.TRIAL } : {}),
      },
    });

    await tx.planHistory.create({
      data: { agencyId: id, action: PlanHistoryAction.TRIAL_EXTENDED, assignedById: user.userId },
    });
  });

  await logActivity(user.userId, "trial_extended", "Agency", id, { days });
  return { message: `Trial extended by ${days} days` };
};

/**
 * Soft delete, and it deactivates the agency's users with it.
 *
 * The old implementation flagged the agency and stopped there, so its staff
 * kept signing in and working normally — nothing in the auth path or the
 * feature gate looked at the flag.
 */
const deleteAgency = async (id: string, user: IRequestUser) => {
  const agency = await prisma.agency.findFirst({ where: { id, isDeleted: false } });
  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");

  await prisma.$transaction(async (tx) => {
    await tx.agency.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), status: AgencyStatus.SUSPENDED },
    });
    await tx.user.updateMany({
      where: { agencyId: id },
      data: { status: UserStatus.BLOCKED, isDeleted: true, deletedAt: new Date() },
    });
    await tx.session.deleteMany({ where: { user: { agencyId: id } } });
  });

  await logActivity(user.userId, "agency_deleted", "Agency", id, { name: agency.name });
  return { message: "Agency deleted successfully" };
};

/* -------------------------------- stats --------------------------------- */

const getPlatformStats = async () => {
  await AgencyLifecycleService.expireLapsedAgencies();

  const soon = addDays(new Date(), 7);

  const [byStatus, totalAgencies, expiringSoon, onlineRevenue, manualRevenue, openTickets, activePlans] =
    await Promise.all([
      prisma.agency.groupBy({ by: ["status"], where: { isDeleted: false }, _count: { _all: true } }),
      prisma.agency.count({ where: { isDeleted: false } }),
      prisma.agency.count({
        where: {
          isDeleted: false,
          status: AgencyStatus.ACTIVE,
          subscriptionEndsAt: { gte: new Date(), lte: soon },
        },
      }),
      prisma.subscriptionOrder.aggregate({
        where: { status: SubscriptionOrderStatus.SUCCESS },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({ _sum: { amount: true } }),
      prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      prisma.agency.findMany({
        where: { isDeleted: false, status: AgencyStatus.ACTIVE, planId: { not: null } },
        include: { plan: { select: { price: true, durationDays: true } } },
      }),
    ]);

  // Monthly recurring revenue, normalising each plan's price to a 30-day month.
  const mrr = activePlans.reduce((sum, agency) => {
    if (!agency.plan || agency.plan.durationDays <= 0) return sum;
    return sum + toNumber(agency.plan.price) / (agency.plan.durationDays / 30);
  }, 0);

  const online = toNumber(onlineRevenue._sum.amount);
  const manual = toNumber(manualRevenue._sum.amount);

  return {
    totalAgencies,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    expiringSoon,
    onlineRevenue: online,
    manualRevenue: manual,
    totalRevenue: online + manual,
    mrr: Math.round(mrr * 100) / 100,
    openTickets,
  };
};

const listActivityLog = async (query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.AdminActivityLogGetPayload<object>,
    Prisma.AdminActivityLogWhereInput,
    Prisma.AdminActivityLogInclude
  >(prisma.adminActivityLog, query, {
    searchableFields: ["action", "targetType"],
    filterableFields: ["action", "targetType", "adminId"],
  });

  return queryBuilder
    .search()
    .filter()
    .include({ admin: { select: { id: true, name: true, email: true } } })
    .paginate()
    .sort()
    .fields()
    .execute();
};

/* ---------------------------------- jobs --------------------------------- */

/** Runs the subscription lifecycle now, instead of waiting for the hour. */
const runSubscriptionLifecycle = async (user: IRequestUser) => {
  const summary = await AgencyLifecycleService.runSubscriptionLifecycle();
  await logActivity(user.userId, "lifecycle_run", "Platform", null, {
    expired: summary.expired,
    reminders: summary.reminders,
    emails: summary.emails,
  });
  return summary;
};

export const AdminService = {
  createPlan,
  listPlans,
  updatePlan,
  deactivatePlan,
  listAgencies,
  getAgencyById,
  updateAgencyStatus,
  assignPlan,
  extendTrial,
  deleteAgency,
  getPlatformStats,
  runSubscriptionLifecycle,
  listActivityLog,
};
