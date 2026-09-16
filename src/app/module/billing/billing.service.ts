import status from "http-status";
import { addDays } from "date-fns";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  AgencyStatus,
  PlanHistoryAction,
  SubscriptionOrderStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { logger } from "../../lib/logger.js";
import {
  buildTransactionId,
  createPaymentSession,
  validateOrder,
} from "../../utils/sslcommerz.js";

const toNumber = PostingService.toNumber;

/**
 * Extends a subscription from the later of now or its current end date, so
 * paying early never costs the agency the days it has already bought — and
 * sets the plan being paid for.
 *
 * This is the only renewal path. The old implementation had two that disagreed:
 * this one stacked, while the admin's assign-plan reset the end date to
 * now + duration and silently discarded whatever time was left.
 */
const renewSubscription = async (
  client: Prisma.TransactionClient,
  agencyId: string,
  planId: string,
  durationDays: number,
  actorId: string | null,
  action: PlanHistoryAction,
) => {
  const agency = await client.agency.findUniqueOrThrow({ where: { id: agencyId } });

  const base =
    agency.subscriptionEndsAt && agency.subscriptionEndsAt.getTime() > Date.now()
      ? agency.subscriptionEndsAt
      : new Date();

  await client.agency.update({
    where: { id: agencyId },
    data: {
      // Paying for a plan puts the agency on that plan. The old code renewed
      // the dates but left planId untouched, so an agency that paid to upgrade
      // got more time on its old plan's features.
      planId,
      subscriptionEndsAt: addDays(base, durationDays),
      status: AgencyStatus.ACTIVE,
    },
  });

  await client.planHistory.create({
    data: { agencyId, planId, action, assignedById: actorId },
  });
};

const listAvailablePlans = async (agencyId: string) => {
  const [plans, agency] = await Promise.all([
    prisma.plan.findMany({ where: { isActive: true, isDeleted: false }, orderBy: { price: "asc" } }),
    prisma.agency.findUnique({ where: { id: agencyId }, select: { planId: true } }),
  ]);

  return plans.map((plan) => ({
    ...plan,
    price: toNumber(plan.price),
    isCurrentPlan: plan.id === agency?.planId,
  }));
};

const getMySubscription = async (agencyId: string) => {
  const agency = await prisma.agency.findFirst({
    where: { id: agencyId, isDeleted: false },
    include: { plan: true },
  });
  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");

  const now = Date.now();
  const trialDaysLeft = agency.trialEndsAt
    ? Math.max(Math.ceil((agency.trialEndsAt.getTime() - now) / 86_400_000), 0)
    : 0;
  const subscriptionDaysLeft = agency.subscriptionEndsAt
    ? Math.max(Math.ceil((agency.subscriptionEndsAt.getTime() - now) / 86_400_000), 0)
    : 0;

  return {
    status: agency.status,
    trialEndsAt: agency.trialEndsAt,
    subscriptionEndsAt: agency.subscriptionEndsAt,
    trialDaysLeft,
    subscriptionDaysLeft,
    plan: agency.plan ? { ...agency.plan, price: toNumber(agency.plan.price) } : null,
  };
};

/**
 * Opens a checkout session. The order row is written first so a gateway
 * failure still leaves a record of the attempt.
 */
const startCheckout = async (agencyId: string, planId: string, user: IRequestUser) => {
  const [agency, plan] = await Promise.all([
    prisma.agency.findFirst({ where: { id: agencyId, isDeleted: false } }),
    prisma.plan.findFirst({ where: { id: planId, isActive: true, isDeleted: false } }),
  ]);

  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");
  if (!plan) throw new AppError(status.BAD_REQUEST, "That plan is not available");

  const transactionId = buildTransactionId();

  const order = await prisma.subscriptionOrder.create({
    data: {
      agencyId,
      planId,
      // Snapshotted, so a later price change never alters what was charged.
      amount: plan.price,
      transactionId,
      status: SubscriptionOrderStatus.PENDING,
    },
  });

  let session;
  try {
    session = await createPaymentSession({
      transactionId,
      amount: toNumber(plan.price),
      productName: `${plan.name} subscription`,
      customerName: user.email,
      customerEmail: user.email,
      customerPhone: agency.phone,
    });
  } catch (error) {
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: {
        status: SubscriptionOrderStatus.FAILED,
        rawGatewayResponse: { error: error instanceof Error ? error.message : String(error) },
      },
    });
    throw new AppError(status.BAD_GATEWAY, "Could not reach the payment gateway. Please try again.");
  }

  if (session.status !== "SUCCESS" || !session.GatewayPageURL) {
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: {
        status: SubscriptionOrderStatus.FAILED,
        rawGatewayResponse: session as Prisma.InputJsonValue,
      },
    });
    throw new AppError(
      status.BAD_GATEWAY,
      session.failedreason || "Could not start a payment session. Please try again.",
    );
  }

  await prisma.subscriptionOrder.update({
    where: { id: order.id },
    data: { sslcommerzSessionKey: session.sessionkey ?? null },
  });

  return { gatewayUrl: session.GatewayPageURL, transactionId };
};

/**
 * Retries a failed or abandoned attempt.
 *
 * The previous order is cancelled first. The old implementation left it
 * PENDING, so if both it and the retry eventually succeeded the subscription
 * was renewed twice — the agency paid once and the gateway could still settle
 * the first attempt later.
 */
const retryOrder = async (agencyId: string, transactionId: string, user: IRequestUser) => {
  const order = await prisma.subscriptionOrder.findFirst({
    where: { transactionId, agencyId },
  });
  if (!order) throw new AppError(status.NOT_FOUND, "Order not found");

  if (order.status === SubscriptionOrderStatus.SUCCESS) {
    throw new AppError(status.BAD_REQUEST, "That payment already succeeded");
  }
  if (order.status === SubscriptionOrderStatus.CANCELLED) {
    throw new AppError(status.BAD_REQUEST, "That attempt was cancelled — start a new checkout");
  }

  await prisma.subscriptionOrder.update({
    where: { id: order.id },
    data: { status: SubscriptionOrderStatus.CANCELLED },
  });

  return startCheckout(agencyId, order.planId, user);
};

const getOrderStatus = async (agencyId: string, transactionId: string) => {
  const order = await prisma.subscriptionOrder.findFirst({
    where: { transactionId, agencyId },
    select: { transactionId: true, status: true, amount: true, createdAt: true },
  });
  if (!order) throw new AppError(status.NOT_FOUND, "Order not found");

  return { ...order, amount: toNumber(order.amount) };
};

const getPaymentHistory = async (agencyId: string) => {
  const [orders, manual] = await Promise.all([
    prisma.subscriptionOrder.findMany({
      where: { agencyId },
      include: { plan: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.payment.findMany({ where: { agencyId }, orderBy: { paidAt: "desc" } }),
  ]);

  const rows = [
    ...orders.map((order) => ({
      id: order.id,
      source: "online" as const,
      date: order.createdAt,
      planName: order.plan?.name ?? null,
      amount: toNumber(order.amount),
      status: order.status,
      method: order.paymentMethod ? `SSLCommerz (${order.paymentMethod})` : "SSLCommerz",
      reference: order.transactionId,
    })),
    ...manual.map((payment) => ({
      id: payment.id,
      source: "manual" as const,
      date: payment.paidAt,
      planName: null,
      amount: toNumber(payment.amount),
      status: "SUCCESS",
      method: payment.method,
      reference: payment.reference,
    })),
  ];

  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
};

/**
 * The gateway's server-to-server notification, and the only thing that marks an
 * order paid.
 *
 * Always answers 200, including on every failure path, because SSLCommerz
 * retries anything else and each outcome has already been recorded on the order.
 */
const handleIpn = async (body: Record<string, unknown>) => {
  const transactionId = String(body.tran_id ?? "");
  const valId = String(body.val_id ?? "");

  if (!transactionId) return { received: true };

  const order = await prisma.subscriptionOrder.findUnique({ where: { transactionId } });
  if (!order) {
    logger.warn("IPN for an unknown transaction", { gateway: "sslcommerz", transactionId });
    return { received: true };
  }

  if (order.status === SubscriptionOrderStatus.SUCCESS) return { received: true };

  if (body.status !== "VALID") {
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: { status: SubscriptionOrderStatus.FAILED, rawGatewayResponse: body as Prisma.InputJsonValue },
    });
    return { received: true };
  }

  let validation;
  try {
    validation = await validateOrder(valId);
  } catch (error) {
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: {
        status: SubscriptionOrderStatus.FAILED,
        rawGatewayResponse: {
          ipn: body,
          error: error instanceof Error ? error.message : String(error),
        } as Prisma.InputJsonValue,
      },
    });
    return { received: true };
  }

  const statusOk = validation.status === "VALID" || validation.status === "VALIDATED";
  const amountOk = Math.abs(Number(validation.amount) - toNumber(order.amount)) < 1;
  const currencyOk = (validation.currency ?? "BDT") === "BDT";

  if (!statusOk || !amountOk || !currencyOk) {
    await prisma.subscriptionOrder.update({
      where: { id: order.id },
      data: {
        status: SubscriptionOrderStatus.FAILED,
        rawGatewayResponse: { ipn: body, validation } as Prisma.InputJsonValue,
      },
    });
    return { received: true };
  }

  const plan = await prisma.plan.findUnique({ where: { id: order.planId } });

  await prisma.$transaction(async (tx) => {
    // Claim the order atomically. Two notifications for the same payment can
    // arrive at once; only the one that flips the row from not-success wins,
    // and the loser skips renewal entirely.
    const claimed = await tx.subscriptionOrder.updateMany({
      where: { id: order.id, status: { not: SubscriptionOrderStatus.SUCCESS } },
      data: {
        status: SubscriptionOrderStatus.SUCCESS,
        sslcommerzValId: valId,
        paymentMethod: validation.card_type || validation.bank_tran_id || null,
        rawGatewayResponse: { ipn: body, validation } as Prisma.InputJsonValue,
      },
    });

    if (claimed.count === 0) return;
    if (!plan) return;

    await renewSubscription(
      tx,
      order.agencyId,
      order.planId,
      plan.durationDays,
      null,
      PlanHistoryAction.ASSIGNED,
    );
  });

  return { received: true };
};

export const BillingService = {
  listAvailablePlans,
  getMySubscription,
  startCheckout,
  retryOrder,
  getOrderStatus,
  getPaymentHistory,
  handleIpn,
  renewSubscription,
};
