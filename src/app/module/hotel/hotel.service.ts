import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  HotelBookingStatus,
  PostingDirection,
  PostingSource,
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
  HOTEL_BOOKING_TRANSITIONS,
  hotelBookingFilterableFields,
  hotelBookingSearchableFields,
} from "./hotel.constant.js";
import {
  IChangeHotelStatusPayload,
  ICreateHotelBookingPayload,
  IRecordHotelPaymentPayload,
  IUpdateHotelBookingPayload,
} from "./hotel.interface.js";

const toNumber = PostingService.toNumber;

/// A cancelled stay bills nothing — the convention every sales module follows.
const LIVE_BOOKING = {
  isDeleted: false,
  status: { not: HotelBookingStatus.CANCELLED },
} as const;

const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, passportNo: true } },
} satisfies Prisma.HotelBookingInclude;

const MS_PER_NIGHT = 24 * 60 * 60 * 1000;

/**
 * Nights between the two dates, never stored.
 *
 * Two figures for one fact drift: an edit that moved check-out and forgot a
 * stored night count would bill for nights nobody stayed. A same-day booking
 * counts as one night, which is what a hotel charges for it.
 */
export const nightsBetween = (checkIn: Date, checkOut: Date) =>
  Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_NIGHT));

/**
 * The money on a stay, all of it additive:
 *
 *   profit    = sellAmount − costAmount
 *   dueAmount = sellAmount − Σ payments
 *
 * Both amounts are totals snapshotted when the stay was booked.
 */
type DecoratedBooking<T> = Omit<T, "sellAmount" | "costAmount"> & {
  sellAmount: number;
  costAmount: number;
  profit: number;
  nights: number;
  totalPaid: number;
  dueAmount: number;
};

/// One grouped query for a whole page, not one per booking.
const decorateMany = async <
  T extends {
    id: string;
    sellAmount: Prisma.Decimal;
    costAmount: Prisma.Decimal;
    checkIn: Date;
    checkOut: Date;
  },
>(
  agencyId: string,
  bookings: T[],
): Promise<DecoratedBooking<T>[]> => {
  if (bookings.length === 0) return [];

  const paid = await prisma.hotelPayment.groupBy({
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
      nights: nightsBetween(booking.checkIn, booking.checkOut),
      totalPaid,
      dueAmount: sellAmount - totalPaid,
    };
  });
};

const decorate = async <
  T extends {
    id: string;
    sellAmount: Prisma.Decimal;
    costAmount: Prisma.Decimal;
    checkIn: Date;
    checkOut: Date;
  },
>(
  agencyId: string,
  booking: T,
): Promise<DecoratedBooking<T>> => (await decorateMany(agencyId, [booking]))[0]!;

const assertDatesMakeSense = (checkIn: Date, checkOut: Date) => {
  if (checkOut < checkIn) {
    throw new AppError(status.BAD_REQUEST, "Check-out cannot be before check-in");
  }
};

const createBooking = async (
  agencyId: string,
  payload: ICreateHotelBookingPayload,
  user: IRequestUser,
) => {
  const customer = await prisma.customer.findFirst({
    where: { id: payload.customerId, agencyId, isDeleted: false },
  });
  if (!customer) throw new AppError(status.BAD_REQUEST, "Invalid customer for this agency");

  const checkIn = new Date(payload.checkIn);
  const checkOut = new Date(payload.checkOut);
  assertDatesMakeSense(checkIn, checkOut);

  const created = await prisma.hotelBooking.create({
    data: {
      agencyId,
      customerId: payload.customerId,
      hotelName: payload.hotelName,
      city: payload.city,
      country: payload.country,
      bookedThrough: payload.bookedThrough,
      confirmationNo: payload.confirmationNo,
      guestName: payload.guestName,
      checkIn,
      checkOut,
      rooms: payload.rooms ?? 1,
      guests: payload.guests ?? 1,
      roomType: payload.roomType,
      sellAmount: new Prisma.Decimal(payload.sellAmount),
      costAmount: new Prisma.Decimal(payload.costAmount ?? 0),
      note: payload.note,
      createdById: user.userId,
    },
  });

  await prisma.hotelStatusHistory.create({
    data: {
      agencyId,
      bookingId: created.id,
      toStatus: HotelBookingStatus.RESERVED,
      note: "Booking created",
      changedById: user.userId,
    },
  });

  return getBookingById(agencyId, created.id);
};

const getAllBookings = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.HotelBookingGetPayload<{ include: typeof BOOKING_INCLUDE }>,
    Prisma.HotelBookingWhereInput,
    Prisma.HotelBookingInclude
  >(prisma.hotelBooking, query, {
    searchableFields: hotelBookingSearchableFields,
    filterableFields: hotelBookingFilterableFields,
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
    prisma.hotelBooking.aggregate({
      where: { agencyId, ...LIVE_BOOKING },
      _sum: { sellAmount: true, costAmount: true },
    }),
    prisma.hotelPayment.aggregate({
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
  const booking = await prisma.hotelBooking.findFirst({
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

const updateBooking = async (agencyId: string, id: string, payload: IUpdateHotelBookingPayload) => {
  const booking = await prisma.hotelBooking.findFirst({
    where: { id, agencyId, isDeleted: false },
  });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  const checkIn = payload.checkIn ? new Date(payload.checkIn) : booking.checkIn;
  const checkOut = payload.checkOut ? new Date(payload.checkOut) : booking.checkOut;
  assertDatesMakeSense(checkIn, checkOut);

  // The price can be cut, but not below what has already been taken for it —
  // that would leave the stay owing a negative amount.
  if (payload.sellAmount !== undefined) {
    const paid = await prisma.hotelPayment.aggregate({
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

  await prisma.hotelBooking.update({
    where: { id },
    data: {
      hotelName: payload.hotelName,
      city: payload.city,
      ...(payload.country !== undefined && { country: payload.country }),
      ...(payload.bookedThrough !== undefined && { bookedThrough: payload.bookedThrough }),
      ...(payload.confirmationNo !== undefined && { confirmationNo: payload.confirmationNo }),
      guestName: payload.guestName,
      ...(payload.checkIn && { checkIn }),
      ...(payload.checkOut && { checkOut }),
      ...(payload.rooms !== undefined && { rooms: payload.rooms }),
      ...(payload.guests !== undefined && { guests: payload.guests }),
      ...(payload.roomType !== undefined && { roomType: payload.roomType }),
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
  payload: IChangeHotelStatusPayload,
  user: IRequestUser,
) => {
  const booking = await prisma.hotelBooking.findFirst({
    where: { id, agencyId, isDeleted: false },
  });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  const allowed = HOTEL_BOOKING_TRANSITIONS[booking.status] ?? [];
  if (!allowed.includes(payload.status)) {
    throw new AppError(
      status.BAD_REQUEST,
      allowed.length > 0
        ? `Cannot change status from ${booking.status} to ${payload.status}. Allowed: ${allowed.join(", ")}`
        : `This booking is ${booking.status} and cannot change status again`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.hotelBooking.update({ where: { id }, data: { status: payload.status } });
    await tx.hotelStatusHistory.create({
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
  payload: IRecordHotelPaymentPayload,
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
    ? await prisma.hotelBooking.findFirst({
        where: { id: bookingId, agencyId, isDeleted: false },
        select: { customerId: true },
      })
    : null;
  if (fromWallet && !owner) throw new AppError(status.NOT_FOUND, "Booking not found");

  await prisma.$transaction(async (tx) => {
    if (owner) await lockRow(tx, "customer", owner.customerId, agencyId);

    // So simultaneous payments for this booking queue instead of each summing
    // the same total and all being allowed through. See rowLock.ts.
    await lockRow(tx, "hotelBooking", bookingId, agencyId);

    const booking = await tx.hotelBooking.findFirstOrThrow({
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

    const agg = await tx.hotelPayment.aggregate({
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

    const payment = await tx.hotelPayment.create({
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
  const payment = await prisma.hotelPayment.findFirst({
    where: { id: paymentId, bookingId, agencyId },
  });
  if (!payment) throw new AppError(status.NOT_FOUND, "Payment not found");

  await prisma.$transaction(async (tx) => {
    // A no-op for a wallet payment, which never posted: reversing it simply
    // gives the customer their balance back.
    await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, paymentId);
    await tx.hotelPayment.delete({ where: { id: paymentId } });
  });

  return getBookingById(agencyId, bookingId);
};

const deleteBooking = async (agencyId: string, id: string) => {
  const booking = await prisma.hotelBooking.findFirst({
    where: { id, agencyId, isDeleted: false },
  });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  await prisma.$transaction(async (tx) => {
    const payments = await tx.hotelPayment.findMany({ where: { agencyId, bookingId: id } });
    for (const payment of payments) {
      await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, payment.id);
    }
    await tx.hotelPayment.deleteMany({ where: { agencyId, bookingId: id } });
    await tx.hotelBooking.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  });

  return { message: "Booking deleted successfully" };
};

/** The module's own dashboard: what is booked, what is owed, who is arriving. */
const getSummary = async (agencyId: string) => {
  const now = new Date();

  const [bookings, byStatus, revenue, collected, arriving] = await Promise.all([
    prisma.hotelBooking.count({ where: { agencyId, ...LIVE_BOOKING } }),
    prisma.hotelBooking.groupBy({
      by: ["status"],
      where: { agencyId, isDeleted: false },
      _count: { _all: true },
    }),
    prisma.hotelBooking.aggregate({
      where: { agencyId, ...LIVE_BOOKING },
      _sum: { sellAmount: true, costAmount: true, rooms: true, guests: true },
    }),
    prisma.hotelPayment.aggregate({
      where: { agencyId, booking: { ...LIVE_BOOKING } },
      _sum: { amount: true },
    }),
    prisma.hotelBooking.findMany({
      where: { agencyId, ...LIVE_BOOKING, checkIn: { gte: now } },
      include: BOOKING_INCLUDE,
      orderBy: { checkIn: "asc" },
      take: 5,
    }),
  ]);

  const totalRevenue = toNumber(revenue._sum.sellAmount);
  const totalCost = toNumber(revenue._sum.costAmount);
  const totalCollected = toNumber(collected._sum.amount);

  return {
    totalBookings: bookings,
    totalRooms: revenue._sum.rooms ?? 0,
    totalGuests: revenue._sum.guests ?? 0,
    statusBreakdown: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    totalCollected,
    totalDue: totalRevenue - totalCollected,
    arriving: await decorateMany(agencyId, arriving),
  };
};

export const HotelService = {
  createBooking,
  getAllBookings,
  getBookingById,
  updateBooking,
  changeBookingStatus,
  recordPayment,
  deletePayment,
  deleteBooking,
  getSummary,
};
