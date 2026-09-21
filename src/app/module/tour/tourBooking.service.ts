import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  PostingDirection,
  PostingSource,
  TourBookingStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { lockRow } from "../../utils/rowLock.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { WalletService } from "../wallet/wallet.service.js";
import {
  TOUR_BOOKING_TRANSITIONS,
  tourBookingFilterableFields,
  tourBookingSearchableFields,
} from "./tour.constant.js";
import { LIVE_BOOKING } from "./tour.service.js";
import {
  IChangeTourStatusPayload,
  ICreateTourBookingPayload,
  IRecordTourPaymentPayload,
  IUpdateTourBookingPayload,
} from "./tour.interface.js";

const toNumber = PostingService.toNumber;

const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, passportNo: true } },
  tourPackage: {
    select: {
      id: true,
      name: true,
      destination: true,
      departureDate: true,
      returnDate: true,
      pricePerPerson: true,
    },
  },
} satisfies Prisma.TourBookingInclude;

/**
 * The money on a booking, all of it additive:
 *
 *   profit    = sellAmount − costAmount
 *   dueAmount = sellAmount − Σ payments
 *
 * Both amounts are totals snapshotted when the booking was made, so a price
 * change on the tour never moves an existing balance.
 */
type DecoratedBooking<T> = Omit<T, "sellAmount" | "costAmount"> & {
  sellAmount: number;
  costAmount: number;
  profit: number;
  totalPaid: number;
  dueAmount: number;
};

/// One grouped query for a whole page, not one per booking — see
/// test/queryCount.test.ts.
const decorateMany = async <
  T extends { id: string; sellAmount: Prisma.Decimal; costAmount: Prisma.Decimal },
>(
  agencyId: string,
  bookings: T[],
): Promise<DecoratedBooking<T>[]> => {
  if (bookings.length === 0) return [];

  const paid = await prisma.tourPayment.groupBy({
    by: ["bookingId"],
    where: { agencyId, bookingId: { in: bookings.map((booking) => booking.id) } },
    _sum: { amount: true },
  });
  const paidByBooking = new Map(paid.map((row) => [row.bookingId, toNumber(row._sum.amount)]));

  return bookings.map((booking) => {
    const sellAmount = toNumber(booking.sellAmount);
    const costAmount = toNumber(booking.costAmount);
    const totalPaid = paidByBooking.get(booking.id) ?? 0;

    return {
      ...booking,
      sellAmount,
      costAmount,
      profit: sellAmount - costAmount,
      totalPaid,
      dueAmount: sellAmount - totalPaid,
    };
  });
};

const decorate = async <
  T extends { id: string; sellAmount: Prisma.Decimal; costAmount: Prisma.Decimal },
>(
  agencyId: string,
  booking: T,
): Promise<DecoratedBooking<T>> => (await decorateMany(agencyId, [booking]))[0]!;

/**
 * Seats and price both come from the tour, and both are snapshotted: the price
 * because a later change must not move this balance, the seats because a
 * cancellation has to give them back.
 */
const createBooking = async (
  agencyId: string,
  payload: ICreateTourBookingPayload,
  user: IRequestUser,
) => {
  const [customer, tourPackage] = await Promise.all([
    prisma.customer.findFirst({ where: { id: payload.customerId, agencyId, isDeleted: false } }),
    prisma.tourPackage.findFirst({ where: { id: payload.packageId, agencyId, isDeleted: false } }),
  ]);

  if (!customer) throw new AppError(status.BAD_REQUEST, "Invalid customer for this agency");
  if (!tourPackage) throw new AppError(status.BAD_REQUEST, "Invalid tour for this agency");
  if (tourPackage.status !== "OPEN") {
    throw new AppError(status.BAD_REQUEST, `This tour is ${tourPackage.status.toLowerCase()}`);
  }

  const travellers = payload.travellers ?? 1;

  const created = await prisma.$transaction(async (tx) => {
    // Seats are counted live, and cancelled bookings hold none. Two clerks
    // selling the last seats at once is exactly what this guards.
    if (tourPackage.seatCapacity !== null) {
      const sold = await tx.tourBooking.aggregate({
        where: { agencyId, packageId: payload.packageId, ...LIVE_BOOKING },
        _sum: { travellers: true },
      });
      const seatsLeft = tourPackage.seatCapacity - (sold._sum.travellers ?? 0);
      if (travellers > seatsLeft) {
        throw new AppError(
          status.BAD_REQUEST,
          seatsLeft > 0
            ? `Only ${seatsLeft} seats are left on this tour`
            : "This tour is full",
        );
      }
    }

    return tx.tourBooking.create({
      data: {
        agencyId,
        customerId: payload.customerId,
        packageId: payload.packageId,
        leadTraveller: payload.leadTraveller,
        travellers,
        sellAmount: new Prisma.Decimal(
          payload.sellAmount ?? toNumber(tourPackage.pricePerPerson) * travellers,
        ),
        costAmount: new Prisma.Decimal(
          payload.costAmount ?? toNumber(tourPackage.costPerPerson) * travellers,
        ),
        note: payload.note,
        createdById: user.userId,
      },
    });
  });

  await prisma.tourStatusHistory.create({
    data: {
      agencyId,
      bookingId: created.id,
      toStatus: TourBookingStatus.RESERVED,
      note: "Booking created",
      changedById: user.userId,
    },
  });

  return getBookingById(agencyId, created.id);
};

const getAllBookings = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.TourBookingGetPayload<{ include: typeof BOOKING_INCLUDE }>,
    Prisma.TourBookingWhereInput,
    Prisma.TourBookingInclude
  >(prisma.tourBooking, query, {
    searchableFields: tourBookingSearchableFields,
    filterableFields: tourBookingFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .include(BOOKING_INCLUDE)
    .paginate()
    .sort()
    .fields()
    .execute();

  const [revenue, collected] = await Promise.all([
    prisma.tourBooking.aggregate({
      where: { agencyId, ...LIVE_BOOKING },
      _sum: { sellAmount: true, costAmount: true },
    }),
    prisma.tourPayment.aggregate({
      where: { agencyId, booking: { ...LIVE_BOOKING } },
      _sum: { amount: true },
    }),
  ]);

  const totalRevenue = toNumber(revenue._sum.sellAmount);
  const totalCost = toNumber(revenue._sum.costAmount);
  const totalPaid = toNumber(collected._sum.amount);

  return {
    ...result,
    data: await decorateMany(agencyId, result.data),
    summary: {
      totalRevenue,
      totalCost,
      totalProfit: totalRevenue - totalCost,
      totalPaid,
      totalDue: totalRevenue - totalPaid,
    },
  };
};

const getBookingById = async (agencyId: string, id: string) => {
  const booking = await prisma.tourBooking.findFirst({
    where: { id, agencyId, isDeleted: false },
    include: {
      ...BOOKING_INCLUDE,
      payments: {
        include: { cashAccount: { select: { id: true, name: true } } },
        orderBy: { paidAt: "asc" },
      },
      statusHistory: { orderBy: { changedAt: "asc" } },
    },
  });

  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");
  return decorate(agencyId, booking);
};

const updateBooking = async (agencyId: string, id: string, payload: IUpdateTourBookingPayload) => {
  const booking = await prisma.tourBooking.findFirst({
    where: { id, agencyId, isDeleted: false },
    include: { tourPackage: { select: { seatCapacity: true } } },
  });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  // Adding travellers has to clear the same seat check selling them did.
  if (payload.travellers !== undefined && booking.tourPackage.seatCapacity !== null) {
    const sold = await prisma.tourBooking.aggregate({
      where: { agencyId, packageId: booking.packageId, id: { not: id }, ...LIVE_BOOKING },
      _sum: { travellers: true },
    });
    const seatsLeft = booking.tourPackage.seatCapacity - (sold._sum.travellers ?? 0);
    if (payload.travellers > seatsLeft) {
      throw new AppError(status.BAD_REQUEST, `Only ${seatsLeft} seats are left on this tour`);
    }
  }

  // The price can be cut, but not below what has already been taken for it —
  // that would leave the booking owing a negative amount.
  if (payload.sellAmount !== undefined) {
    const paid = await prisma.tourPayment.aggregate({
      where: { agencyId, bookingId: id },
      _sum: { amount: true },
    });
    const totalPaid = toNumber(paid._sum.amount);
    if (payload.sellAmount < totalPaid) {
      throw new AppError(
        status.BAD_REQUEST,
        `${totalPaid.toFixed(2)} has already been paid against this booking`,
      );
    }
  }

  await prisma.tourBooking.update({
    where: { id },
    data: {
      leadTraveller: payload.leadTraveller,
      ...(payload.travellers !== undefined && { travellers: payload.travellers }),
      ...(payload.sellAmount !== undefined && {
        sellAmount: new Prisma.Decimal(payload.sellAmount),
      }),
      ...(payload.costAmount !== undefined && {
        costAmount: new Prisma.Decimal(payload.costAmount),
      }),
      ...(payload.note !== undefined && { note: payload.note }),
    },
  });

  return getBookingById(agencyId, id);
};

const changeBookingStatus = async (
  agencyId: string,
  id: string,
  payload: IChangeTourStatusPayload,
  user: IRequestUser,
) => {
  const booking = await prisma.tourBooking.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  const allowed = TOUR_BOOKING_TRANSITIONS[booking.status] ?? [];
  if (!allowed.includes(payload.status)) {
    throw new AppError(
      status.BAD_REQUEST,
      allowed.length > 0
        ? `Cannot change status from ${booking.status} to ${payload.status}. Allowed: ${allowed.join(", ")}`
        : `This booking is ${booking.status} and cannot change status again`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.tourBooking.update({ where: { id }, data: { status: payload.status } });
    await tx.tourStatusHistory.create({
      data: {
        agencyId,
        bookingId: id,
        fromStatus: booking.status,
        toStatus: payload.status,
        note: payload.note,
        changedById: user.userId,
      },
    });
  });

  return getBookingById(agencyId, id);
};

const recordPayment = async (
  agencyId: string,
  bookingId: string,
  payload: IRecordTourPaymentPayload,
  user: IRequestUser,
) => {
  const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
  const fromWallet = payload.fromWallet === true;

  if (!fromWallet && !payload.cashAccountId) {
    throw new AppError(status.BAD_REQUEST, "Choose the account the money went into");
  }

  // Which wallet to lock has to be known before the transaction opens, because
  // the customer is locked before the booking (rowLock.ts).
  const owner = fromWallet
    ? await prisma.tourBooking.findFirst({
        where: { id: bookingId, agencyId, isDeleted: false },
        select: { customerId: true },
      })
    : null;
  if (fromWallet && !owner) throw new AppError(status.NOT_FOUND, "Booking not found");

  await prisma.$transaction(async (tx) => {
    if (owner) await lockRow(tx, "customer", owner.customerId, agencyId);

    // So simultaneous payments for this booking queue instead of each summing
    // the same total and all being allowed through. See rowLock.ts.
    await lockRow(tx, "tourBooking", bookingId, agencyId);

    // Re-read under the lock: the price must be the committed one, not a
    // snapshot taken before the transaction opened.
    const booking = await tx.tourBooking.findFirstOrThrow({
      where: { id: bookingId, agencyId, isDeleted: false },
    });

    if (owner && booking.customerId !== owner.customerId) {
      throw new AppError(
        status.CONFLICT,
        "This booking was moved to another customer while you were paying — try again",
      );
    }

    if (fromWallet) {
      await WalletService.assertCovers(tx, agencyId, booking.customerId, payload.amount);
    } else {
      await PostingService.assertPostableAccount(tx, agencyId, payload.cashAccountId!);
    }

    const agg = await tx.tourPayment.aggregate({
      where: { agencyId, bookingId },
      _sum: { amount: true },
    });
    const due = toNumber(booking.sellAmount) - toNumber(agg._sum.amount);

    if (payload.amount > due) {
      throw new AppError(
        status.BAD_REQUEST,
        `Cannot take more than the outstanding due of ${due.toFixed(2)}`,
      );
    }

    const payment = await tx.tourPayment.create({
      data: {
        agencyId,
        bookingId,
        cashAccountId: fromWallet ? null : payload.cashAccountId,
        fromWallet,
        amount: new Prisma.Decimal(payload.amount),
        method: payload.method,
        reference: payload.reference,
        note: payload.note,
        paidAt,
      },
    });

    // A wallet payment posts nothing: the cash arrived when the customer paid
    // it in, and posting it again would put the same money on the balance
    // sheet twice.
    if (!fromWallet) {
      await PostingService.post(tx, {
        agencyId,
        cashAccountId: payload.cashAccountId!,
        direction: PostingDirection.IN,
        amount: payload.amount,
        source: PostingSource.SALES_PAYMENT,
        sourceId: payment.id,
        postedAt: paidAt,
        note: payload.note,
        createdById: user.userId,
      });
    }
  });

  return getBookingById(agencyId, bookingId);
};

const deletePayment = async (agencyId: string, bookingId: string, paymentId: string) => {
  const payment = await prisma.tourPayment.findFirst({
    where: { id: paymentId, bookingId, agencyId },
  });
  if (!payment) throw new AppError(status.NOT_FOUND, "Payment not found");

  await prisma.$transaction(async (tx) => {
    // A no-op for a wallet payment, which never posted: reversing it simply
    // gives the customer their balance back.
    await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, paymentId);
    await tx.tourPayment.delete({ where: { id: paymentId } });
  });

  return getBookingById(agencyId, bookingId);
};

const deleteBooking = async (agencyId: string, id: string) => {
  const booking = await prisma.tourBooking.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  await prisma.$transaction(async (tx) => {
    const payments = await tx.tourPayment.findMany({ where: { agencyId, bookingId: id } });
    for (const payment of payments) {
      await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, payment.id);
    }
    await tx.tourPayment.deleteMany({ where: { agencyId, bookingId: id } });
    await tx.tourBooking.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  });

  return { message: "Booking deleted successfully" };
};

export const TourBookingService = {
  createBooking,
  getAllBookings,
  getBookingById,
  updateBooking,
  changeBookingStatus,
  recordPayment,
  deletePayment,
  deleteBooking,
};
