import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  PaymentChannel,
  PlanHistoryAction,
  SubscriptionOrderStatus,
} from "../../../generated/prisma/enums.js";
import { env } from "../../../config/env.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { renewSubscription } from "./renewSubscription.js";

/**
 * Paying by bKash, and an operator reading the receipt.
 *
 * The gateway confirms itself: SSLCommerz calls back, we validate the call
 * against their API, and the plan turns on without anyone watching. bKash has
 * none of that. What arrives here is what the agency typed off their phone —
 * a number and a transaction id — which is a claim, not a payment.
 *
 * So the order is created PENDING and nothing else happens. An operator opens
 * their bKash statement, finds the transaction, and approves it; only then is
 * the plan renewed, through the same one path every other renewal takes. The
 * agency cannot move its own order, whatever it sends.
 */

/** Digits, spaces and the odd +88 an agency will paste from their SMS. */
const PHONE = /^[\d\s+-]{11,20}$/;

/**
 * bKash prints a short alphanumeric id on every transaction. Kept loose on
 * purpose — the operator is the real check, and a format rule that rejects a
 * genuine receipt is worse than one that lets a wrong id through to be refused
 * by a person.
 */
const REFERENCE = /^[A-Za-z0-9]{6,32}$/;

export interface IManualPaymentPayload {
  planId: string;
  senderNumber: string;
  senderReference: string;
}

/**
 * Where to send the money, for the screen that asks for it.
 *
 * The number lives in the environment rather than in the code: it is the
 * operator's own bKash account, it changes without a release, and it is not
 * something a tenant should be able to edit.
 */
const getPaymentInstructions = () => {
  const number = env.BKASH_MERCHANT_NUMBER.trim();

  return {
    number,
    /** False when nobody has set a number yet — the screen says so instead of
     * inviting a payment into the void. */
    available: number.length > 0,
  };
};

const buildTransactionId = (agencyId: string) =>
  `BKASH-${agencyId.slice(0, 8)}-${Date.now()}`;

/**
 * Records a claim that the agency has paid.
 *
 * Deliberately does not touch the subscription. The only thing this writes is
 * a row saying "they say they sent this" — everything else waits for a person.
 */
const submit = async (agencyId: string, payload: IManualPaymentPayload) => {
  const instructions = getPaymentInstructions();
  if (!instructions.available) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      "Paying by bKash is not set up on this server yet. Ask your administrator to add the bKash number.",
    );
  }

  const senderNumber = payload.senderNumber.trim();
  const senderReference = payload.senderReference.trim();

  if (!PHONE.test(senderNumber)) {
    throw new AppError(status.BAD_REQUEST, "Enter the bKash number you paid from");
  }
  if (!REFERENCE.test(senderReference)) {
    throw new AppError(
      status.BAD_REQUEST,
      "Enter the transaction ID from your bKash message — letters and numbers only",
    );
  }

  const plan = await prisma.plan.findFirst({
    where: { id: payload.planId, isActive: true, isDeleted: false },
  });
  if (!plan) throw new AppError(status.BAD_REQUEST, "That plan is not available");

  // One at a time. A second submission while the first is unread is either a
  // double-click or somebody hoping two receipts get one approval each.
  const waiting = await prisma.subscriptionOrder.findFirst({
    where: {
      agencyId,
      channel: PaymentChannel.BKASH_MANUAL,
      status: SubscriptionOrderStatus.PENDING,
    },
  });
  if (waiting) {
    throw new AppError(
      status.CONFLICT,
      "You already have a bKash payment waiting to be checked. We will confirm it shortly.",
    );
  }

  try {
    const order = await prisma.subscriptionOrder.create({
      data: {
        agencyId,
        planId: plan.id,
        amount: plan.price,
        transactionId: buildTransactionId(agencyId),
        channel: PaymentChannel.BKASH_MANUAL,
        status: SubscriptionOrderStatus.PENDING,
        paymentMethod: "bKash",
        senderNumber,
        senderReference,
      },
      include: { plan: { select: { id: true, name: true } } },
    });

    return {
      id: order.id,
      status: order.status,
      planName: order.plan.name,
      amount: Number(order.amount),
      senderReference: order.senderReference,
      createdAt: order.createdAt,
    };
  } catch (error) {
    // The unique index on senderReference. Someone is reusing a receipt —
    // possibly their own, by mistake, possibly not their own.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        status.CONFLICT,
        "That transaction ID has already been submitted. Check the ID in your bKash message.",
      );
    }
    throw error;
  }
};

/** What the agency sees while it waits, so the screen is not a dead end. */
const getMyPending = async (agencyId: string) => {
  const order = await prisma.subscriptionOrder.findFirst({
    where: {
      agencyId,
      channel: PaymentChannel.BKASH_MANUAL,
      status: SubscriptionOrderStatus.PENDING,
    },
    include: { plan: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (!order) return null;

  return {
    id: order.id,
    planName: order.plan.name,
    amount: Number(order.amount),
    senderNumber: order.senderNumber,
    senderReference: order.senderReference,
    createdAt: order.createdAt,
  };
};

/** The operator's queue. Oldest first: somebody has been waiting longest. */
const listForReview = async (query: { status?: SubscriptionOrderStatus }) => {
  const orders = await prisma.subscriptionOrder.findMany({
    where: {
      channel: PaymentChannel.BKASH_MANUAL,
      status: query.status ?? SubscriptionOrderStatus.PENDING,
    },
    include: {
      plan: { select: { id: true, name: true, durationDays: true } },
      agency: { select: { id: true, name: true, phone: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return orders.map((order) => ({
    id: order.id,
    status: order.status,
    amount: Number(order.amount),
    senderNumber: order.senderNumber,
    senderReference: order.senderReference,
    createdAt: order.createdAt,
    reviewedAt: order.reviewedAt,
    reviewNote: order.reviewNote,
    plan: order.plan,
    agency: order.agency,
  }));
};

/**
 * Accepts or refuses one claim.
 *
 * Approving renews through renewSubscription — the single path every renewal
 * takes, so a bKash payment stacks onto whatever time is left exactly as a card
 * payment does, and lands in the plan history with the operator's name on it.
 */
const review = async (
  orderId: string,
  input: { approve: boolean; note?: string },
  user: IRequestUser,
) => {
  const order = await prisma.subscriptionOrder.findFirst({
    where: { id: orderId, channel: PaymentChannel.BKASH_MANUAL },
    include: { plan: true },
  });
  if (!order) throw new AppError(status.NOT_FOUND, "That bKash payment was not found");
  if (order.status !== SubscriptionOrderStatus.PENDING) {
    throw new AppError(
      status.BAD_REQUEST,
      `This payment has already been ${order.status === SubscriptionOrderStatus.SUCCESS ? "approved" : "refused"}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Re-read under the transaction: two operators reading the same queue is
    // ordinary, and approving twice would grant two renewals for one receipt.
    const claimed = await tx.subscriptionOrder.updateMany({
      where: { id: orderId, status: SubscriptionOrderStatus.PENDING },
      data: {
        status: input.approve
          ? SubscriptionOrderStatus.SUCCESS
          : SubscriptionOrderStatus.FAILED,
        reviewedById: user.userId,
        reviewedAt: new Date(),
        reviewNote: input.note?.trim() || null,
      },
    });

    if (claimed.count === 0) {
      throw new AppError(status.CONFLICT, "Somebody else has just reviewed this payment");
    }

    if (input.approve) {
      await renewSubscription(
        tx,
        order.agencyId,
        order.planId,
        order.plan.durationDays,
        user.userId,
        // The same action a card payment records: this is a renewal like any
        // other, differing only in who confirmed it.
        PlanHistoryAction.ASSIGNED,
      );
    }
  });

  return { id: order.id, approved: input.approve };
};

export const ManualPaymentService = {
  getPaymentInstructions,
  submit,
  getMyPending,
  listForReview,
  review,
};
