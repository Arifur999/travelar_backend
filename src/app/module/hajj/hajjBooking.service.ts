import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
  DocumentStatus,
  HajjBookingStatus,
  HajjHotelType,
  PostingDirection,
  PostingSource,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { WalletService } from "../wallet/wallet.service.js";
import { LIVE_BOOKING } from "./hajj.service.js";
import { lockRow } from "../../utils/rowLock.js";
import {
  HAJJ_BOOKING_TRANSITIONS,
  getHajjDocumentPreset,
  hajjBookingFilterableFields,
  hajjBookingSearchableFields,
} from "./hajj.constant.js";
import {
  IAssignRoomPayload,
  IChangeBookingStatusPayload,
  ICreateHajjBookingPayload,
  IRecordHajjPaymentPayload,
} from "./hajj.interface.js";

const toNumber = PostingService.toNumber;

const BOOKING_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, passportNo: true } },
  hajjPackage: { select: { id: true, name: true, type: true, tier: true } },
  batch: { select: { id: true, name: true, departureDate: true } },
  makkahRoom: { select: { id: true, roomNumber: true, capacity: true } },
  madinahRoom: { select: { id: true, roomNumber: true, capacity: true } },
} satisfies Prisma.HajjBookingInclude;

// Generic so callers keep the full row type — the spread below passes every
// field through at runtime. packagePrice is Omit-ted from T because it is
// replaced by a plain number; left in, the type claimed Decimal & number and a
// caller that trusted it to still be a Decimal crashed.
type DecoratedBooking<T> = Omit<T, "packagePrice"> & {
  packagePrice: number;
  totalPaid: number;
  dueAmount: number;
  documentsProgress: { received: number; total: number };
};

// Two grouped queries for a whole page (payments, document statuses), not two
// per booking as before — see test/queryCount.test.ts.
const decorateMany = async <T extends { id: string; packagePrice: Prisma.Decimal }>(
  agencyId: string,
  bookings: T[],
): Promise<DecoratedBooking<T>[]> => {
  if (bookings.length === 0) return [];
  const ids = bookings.map((booking) => booking.id);

  const [paid, documents] = await Promise.all([
    prisma.hajjPayment.groupBy({
      by: ["bookingId"],
      where: { agencyId, bookingId: { in: ids } },
      _sum: { amount: true },
    }),
    prisma.hajjDocument.groupBy({
      by: ["bookingId", "status"],
      where: { agencyId, bookingId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const paidByBooking = new Map(paid.map((row) => [row.bookingId, toNumber(row._sum.amount)]));
  const progressByBooking = new Map<string, { received: number; total: number }>();
  for (const row of documents) {
    const progress = progressByBooking.get(row.bookingId) ?? { received: 0, total: 0 };
    progress.total += row._count._all;
    if (row.status !== DocumentStatus.PENDING) progress.received += row._count._all;
    progressByBooking.set(row.bookingId, progress);
  }

  return bookings.map((booking) => {
    const packagePrice = toNumber(booking.packagePrice);
    const totalPaid = paidByBooking.get(booking.id) ?? 0;
    return {
      ...booking,
      packagePrice,
      totalPaid,
      dueAmount: packagePrice - totalPaid,
      documentsProgress: progressByBooking.get(booking.id) ?? { received: 0, total: 0 },
    };
  });
};

const decorate = async <T extends { id: string; packagePrice: Prisma.Decimal }>(
  agencyId: string,
  booking: T,
): Promise<DecoratedBooking<T>> => (await decorateMany(agencyId, [booking]))[0]!;

/**
 * One row per pilgrim. The package price is snapshotted at booking time, so a
 * later price change on the package never moves an existing booking's balance.
 */
const createBooking = async (agencyId: string, payload: ICreateHajjBookingPayload, user: IRequestUser) => {
  const [customer, hajjPackage, batch] = await Promise.all([
    prisma.customer.findFirst({ where: { id: payload.customerId, agencyId, isDeleted: false } }),
    prisma.hajjPackage.findFirst({ where: { id: payload.packageId, agencyId, isDeleted: false } }),
    prisma.hajjBatch.findFirst({ where: { id: payload.batchId, agencyId, isDeleted: false } }),
  ]);

  if (!customer) throw new AppError(status.BAD_REQUEST, "Invalid customer for this agency");
  if (!hajjPackage) throw new AppError(status.BAD_REQUEST, "Invalid package for this agency");
  if (!batch) throw new AppError(status.BAD_REQUEST, "Invalid batch for this agency");
  if (batch.packageId !== payload.packageId) {
    throw new AppError(status.BAD_REQUEST, "That batch does not belong to the selected package");
  }

  const created = await prisma.$transaction(async (tx) => {
    // Seats are counted live, and cancelled bookings do not hold one.
    const booked = await tx.hajjBooking.count({
      where: { agencyId, batchId: payload.batchId, ...LIVE_BOOKING },
    });
    if (booked >= batch.seatCapacity) {
      throw new AppError(status.BAD_REQUEST, "This batch is full");
    }

    const booking = await tx.hajjBooking.create({
      data: {
        agencyId,
        customerId: payload.customerId,
        packageId: payload.packageId,
        batchId: payload.batchId,
        pilgrimName: payload.pilgrimName,
        passportNumber: payload.passportNumber,
        munajjimNumber: payload.munajjimNumber,
        packagePrice: new Prisma.Decimal(payload.packagePrice ?? toNumber(hajjPackage.price)),
        createdById: user.userId,
      },
    });

    // Checklist comes from the package type: umrah gets the base list, hajj
    // adds its own two.
    await tx.hajjDocument.createMany({
      data: getHajjDocumentPreset(hajjPackage.type).map((title) => ({
        agencyId,
        bookingId: booking.id,
        title,
      })),
    });

    await tx.hajjStatusHistory.create({
      data: {
        agencyId,
        bookingId: booking.id,
        toStatus: HajjBookingStatus.RESERVED,
        note: "Booking created",
        changedById: user.userId,
      },
    });

    return booking;
  });

  return getBookingById(agencyId, created.id);
};

const getAllBookings = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.HajjBookingGetPayload<{ include: typeof BOOKING_INCLUDE }>,
    Prisma.HajjBookingWhereInput,
    Prisma.HajjBookingInclude
  >(prisma.hajjBooking, query, {
    searchableFields: hajjBookingSearchableFields,
    filterableFields: hajjBookingFilterableFields,
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

  const decorated = await decorateMany(agencyId, result.data);

  const [revenue, collected] = await Promise.all([
    prisma.hajjBooking.aggregate({ where: { agencyId, ...LIVE_BOOKING }, _sum: { packagePrice: true } }),
    prisma.hajjPayment.aggregate({
      where: { agencyId, booking: { ...LIVE_BOOKING } },
      _sum: { amount: true },
    }),
  ]);

  const totalRevenue = toNumber(revenue._sum.packagePrice);
  const totalPaid = toNumber(collected._sum.amount);

  return {
    ...result,
    data: decorated,
    summary: { totalRevenue, totalPaid, totalDue: totalRevenue - totalPaid },
  };
};

const getBookingById = async (agencyId: string, id: string) => {
  const booking = await prisma.hajjBooking.findFirst({
    where: { id, agencyId, isDeleted: false },
    include: {
      ...BOOKING_INCLUDE,
      documents: { orderBy: { createdAt: "asc" } },
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

const changeBookingStatus = async (
  agencyId: string,
  id: string,
  payload: IChangeBookingStatusPayload,
  user: IRequestUser,
) => {
  const booking = await prisma.hajjBooking.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  const allowed = HAJJ_BOOKING_TRANSITIONS[booking.status] ?? [];
  if (!allowed.includes(payload.status)) {
    throw new AppError(
      status.BAD_REQUEST,
      allowed.length > 0
        ? `Cannot change status from ${booking.status} to ${payload.status}. Allowed: ${allowed.join(", ")}`
        : `This booking is ${booking.status} and cannot change status again`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.hajjBooking.update({ where: { id }, data: { status: payload.status } });
    await tx.hajjStatusHistory.create({
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

/**
 * Assigns or clears a hotel room.
 *
 * Capacity excludes this booking so re-selecting the same room is not
 * self-blocking, and it excludes cancelled pilgrims — the old implementation
 * counted them, so a cancelled booking kept holding a bed even though the batch
 * seat check already ignored it.
 */
const assignRoom = async (agencyId: string, id: string, payload: IAssignRoomPayload) => {
  const booking = await prisma.hajjBooking.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  const field = payload.hotelType === HajjHotelType.MAKKAH ? "makkahRoomId" : "madinahRoomId";

  if (!payload.roomId) {
    await prisma.hajjBooking.update({ where: { id }, data: { [field]: null } });
    return getBookingById(agencyId, id);
  }

  const room = await prisma.hajjRoom.findFirst({
    where: { id: payload.roomId, agencyId, isDeleted: false },
  });
  if (!room) throw new AppError(status.BAD_REQUEST, "Invalid room for this agency");
  if (room.hotelType !== payload.hotelType) {
    throw new AppError(status.BAD_REQUEST, "That room is in the other hotel");
  }
  if (room.batchId !== booking.batchId) {
    throw new AppError(status.BAD_REQUEST, "That room does not belong to this pilgrim's batch");
  }

  const occupants = await prisma.hajjBooking.count({
    where: { agencyId, [field]: room.id, id: { not: id }, ...LIVE_BOOKING },
  });
  if (occupants >= room.capacity) {
    throw new AppError(status.BAD_REQUEST, "That room is full");
  }

  await prisma.hajjBooking.update({ where: { id }, data: { [field]: room.id } });
  return getBookingById(agencyId, id);
};

const setDocumentStatus = async (
  agencyId: string,
  bookingId: string,
  documentId: string,
  documentStatus: DocumentStatus,
) => {
  const document = await prisma.hajjDocument.findFirst({
    where: { id: documentId, bookingId, agencyId },
  });
  if (!document) throw new AppError(status.NOT_FOUND, "Checklist item not found");

  await prisma.hajjDocument.update({
    where: { id: documentId },
    data: {
      status: documentStatus,
      receivedAt: documentStatus === DocumentStatus.PENDING ? null : new Date(),
      ...(documentStatus === DocumentStatus.PENDING ? { fileUrl: null } : {}),
    },
  });

  return getBookingById(agencyId, bookingId);
};

const recordPayment = async (
  agencyId: string,
  bookingId: string,
  payload: IRecordHajjPaymentPayload,
  user: IRequestUser,
) => {
  const paidAt = payload.paidAt ? new Date(payload.paidAt) : new Date();
  const fromWallet = payload.fromWallet === true;

  if (!fromWallet && !payload.cashAccountId) {
    throw new AppError(status.BAD_REQUEST, "Choose the account the money went into");
  }

  // Which wallet to lock has to be known before the transaction opens, because
  // the customer is locked before the booking (rowLock.ts). An edit could move
  // the booking to another customer in between, so it is checked again below.
  const owner = fromWallet
    ? await prisma.hajjBooking.findFirst({
        where: { id: bookingId, agencyId, isDeleted: false },
        select: { customerId: true },
      })
    : null;
  if (fromWallet && !owner) throw new AppError(status.NOT_FOUND, "Booking not found");

  await prisma.$transaction(async (tx) => {
    if (owner) await lockRow(tx, "customer", owner.customerId, agencyId);

    // So simultaneous payments for this booking queue instead of each summing
    // the same total and all being allowed through. See rowLock.ts.
    await lockRow(tx, "hajjBooking", bookingId, agencyId);

    // Re-read under the lock: the package price must be the committed one, not
    // a snapshot taken before the transaction opened.
    const booking = await tx.hajjBooking.findFirstOrThrow({
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

    const agg = await tx.hajjPayment.aggregate({
      where: { agencyId, bookingId },
      _sum: { amount: true },
    });
    const due = toNumber(booking.packagePrice) - toNumber(agg._sum.amount);

    if (payload.amount > due) {
      throw new AppError(
        status.BAD_REQUEST,
        `Cannot take more than the outstanding due of ${due.toFixed(2)}`,
      );
    }

    const payment = await tx.hajjPayment.create({
      data: {
        agencyId,
        bookingId,
        cashAccountId: fromWallet ? null : payload.cashAccountId,
        fromWallet,
        amount: new Prisma.Decimal(payload.amount),
        method: payload.method,
        transactionRef: payload.transactionRef,
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
  const payment = await prisma.hajjPayment.findFirst({
    where: { id: paymentId, bookingId, agencyId },
  });
  if (!payment) throw new AppError(status.NOT_FOUND, "Payment not found");

  await prisma.$transaction(async (tx) => {
    await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, paymentId);
    await tx.hajjPayment.delete({ where: { id: paymentId } });
  });

  return getBookingById(agencyId, bookingId);
};

const deleteBooking = async (agencyId: string, id: string) => {
  const booking = await prisma.hajjBooking.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!booking) throw new AppError(status.NOT_FOUND, "Booking not found");

  await prisma.$transaction(async (tx) => {
    const payments = await tx.hajjPayment.findMany({ where: { agencyId, bookingId: id } });
    for (const payment of payments) {
      await PostingService.reverse(tx, PostingSource.SALES_PAYMENT, payment.id);
    }
    await tx.hajjPayment.deleteMany({ where: { agencyId, bookingId: id } });
    await tx.hajjBooking.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  });

  return { message: "Booking deleted successfully" };
};

export const HajjBookingService = {
  createBooking,
  getAllBookings,
  getBookingById,
  changeBookingStatus,
  assignRoom,
  setDocumentStatus,
  recordPayment,
  deletePayment,
  deleteBooking,
};
