import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { HajjBookingStatus, HajjHotelType } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";

import {
  ICreateHajjBatchPayload,
  ICreateHajjPackagePayload,
  ICreateHajjRoomPayload,
} from "./hajj.interface.js";

const toNumber = PostingService.toNumber;

/// A cancelled booking frees its seat and contributes no revenue, which is the
/// convention used consistently across this module.
const LIVE_BOOKING = { isDeleted: false, status: { not: HajjBookingStatus.CANCELLED } } as const;

/* ------------------------------- packages ------------------------------- */

const createPackage = async (agencyId: string, payload: ICreateHajjPackagePayload, user: IRequestUser) => {
  const duplicate = await prisma.hajjPackage.findFirst({
    where: { agencyId, name: { equals: payload.name, mode: "insensitive" }, isDeleted: false },
  });
  if (duplicate) throw new AppError(status.CONFLICT, "A package with this name already exists");

  return prisma.hajjPackage.create({
    data: {
      agencyId,
      name: payload.name,
      type: payload.type,
      tier: payload.tier,
      price: new Prisma.Decimal(payload.price),
      durationDays: payload.durationDays,
      makkahHotel: payload.makkahHotel,
      makkahDistance: payload.makkahDistance,
      madinahHotel: payload.madinahHotel,
      madinahDistance: payload.madinahDistance,
      muallim: payload.muallim,
      mealPlan: payload.mealPlan,
      description: payload.description,
      isActive: payload.isActive ?? true,
      createdById: user.userId,
    },
  });
};

const getAllPackages = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.HajjPackageGetPayload<object>,
    Prisma.HajjPackageWhereInput,
    Prisma.HajjPackageInclude
  >(prisma.hajjPackage, query, {
    searchableFields: ["name", "makkahHotel", "madinahHotel", "muallim", "description"],
    filterableFields: ["type", "tier", "mealPlan", "isActive"],
  });

  return queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .paginate()
    .sort()
    .fields()
    .execute();
};

const updatePackage = async (agencyId: string, id: string, payload: Partial<ICreateHajjPackagePayload>) => {
  const found = await prisma.hajjPackage.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!found) throw new AppError(status.NOT_FOUND, "Package not found");

  return prisma.hajjPackage.update({
    where: { id },
    data: {
      ...payload,
      ...(payload.price !== undefined && { price: new Prisma.Decimal(payload.price) }),
    },
  });
};

/**
 * Refused while batches or bookings still reference it.
 *
 * The old implementation left a comment saying no bookings existed yet so there
 * was nothing to block on — by then bookings very much existed, and deleting a
 * package silently orphaned them.
 */
const deletePackage = async (agencyId: string, id: string) => {
  const found = await prisma.hajjPackage.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!found) throw new AppError(status.NOT_FOUND, "Package not found");

  const [batches, bookings] = await Promise.all([
    prisma.hajjBatch.count({ where: { agencyId, packageId: id, isDeleted: false } }),
    prisma.hajjBooking.count({ where: { agencyId, packageId: id, isDeleted: false } }),
  ]);

  if (batches > 0 || bookings > 0) {
    throw new AppError(status.BAD_REQUEST, "This package is in use and cannot be deleted");
  }

  await prisma.hajjPackage.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  return { message: "Package deleted successfully" };
};

/* -------------------------------- batches ------------------------------- */

/// Seats are counted, never stored, so a cancellation frees one immediately.
const attachSeatCounts = async <T extends { id: string; seatCapacity: number }>(
  agencyId: string,
  batches: T[],
) => {
  if (batches.length === 0) return [];

  const counts = await prisma.hajjBooking.groupBy({
    by: ["batchId"],
    where: { agencyId, batchId: { in: batches.map((b) => b.id) }, ...LIVE_BOOKING },
    _count: { _all: true },
  });

  const bookedMap = new Map(counts.map((c) => [c.batchId, c._count._all]));

  return batches.map((batch) => {
    const bookedSeats = bookedMap.get(batch.id) ?? 0;
    return {
      ...batch,
      bookedSeats,
      availableSeats: Math.max(batch.seatCapacity - bookedSeats, 0),
    };
  });
};

const createBatch = async (agencyId: string, payload: ICreateHajjBatchPayload, user: IRequestUser) => {
  const hajjPackage = await prisma.hajjPackage.findFirst({
    where: { id: payload.packageId, agencyId, isDeleted: false },
  });
  if (!hajjPackage) throw new AppError(status.BAD_REQUEST, "Invalid package for this agency");

  const batch = await prisma.hajjBatch.create({
    data: {
      agencyId,
      packageId: payload.packageId,
      name: payload.name,
      departureDate: new Date(payload.departureDate),
      returnDate: payload.returnDate ? new Date(payload.returnDate) : null,
      seatCapacity: payload.seatCapacity,
      createdById: user.userId,
    },
  });

  const [withSeats] = await attachSeatCounts(agencyId, [batch]);
  return withSeats;
};

const getAllBatches = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.HajjBatchGetPayload<object>,
    Prisma.HajjBatchWhereInput,
    Prisma.HajjBatchInclude
  >(prisma.hajjBatch, query, {
    searchableFields: ["name", "hajjPackage.name"],
    filterableFields: ["packageId", "status", "departureDate"],
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .include({ hajjPackage: { select: { id: true, name: true, type: true } } })
    .paginate()
    .sort()
    .fields()
    .execute();

  return { ...result, data: await attachSeatCounts(agencyId, result.data) };
};

const getBatchSummary = async (agencyId: string, id: string) => {
  const batch = await prisma.hajjBatch.findFirst({
    where: { id, agencyId, isDeleted: false },
    include: { hajjPackage: { select: { id: true, name: true, type: true } } },
  });
  if (!batch) throw new AppError(status.NOT_FOUND, "Batch not found");

  const [withSeats] = await attachSeatCounts(agencyId, [batch]);

  const [byStatus, revenue, collected, rooms] = await Promise.all([
    prisma.hajjBooking.groupBy({
      by: ["status"],
      where: { agencyId, batchId: id, isDeleted: false },
      _count: { _all: true },
    }),
    prisma.hajjBooking.aggregate({
      where: { agencyId, batchId: id, ...LIVE_BOOKING },
      _sum: { packagePrice: true },
    }),
    prisma.hajjPayment.aggregate({
      where: { agencyId, booking: { batchId: id, ...LIVE_BOOKING } },
      _sum: { amount: true },
    }),
    prisma.hajjRoom.findMany({ where: { agencyId, batchId: id, isDeleted: false } }),
  ]);

  // COUNT over a nullable column ignores nulls, so an unassigned pilgrim simply
  // is not counted — no special-casing needed.
  const [makkahOccupied, madinahOccupied] = await Promise.all([
    prisma.hajjBooking.count({ where: { agencyId, batchId: id, ...LIVE_BOOKING, makkahRoomId: { not: null } } }),
    prisma.hajjBooking.count({ where: { agencyId, batchId: id, ...LIVE_BOOKING, madinahRoomId: { not: null } } }),
  ]);

  const totalRevenue = toNumber(revenue._sum.packagePrice);
  const totalCollected = toNumber(collected._sum.amount);

  return {
    ...withSeats,
    statusBreakdown: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    totalRevenue,
    totalCollected,
    totalDue: totalRevenue - totalCollected,
    roomOccupancy: {
      makkah: { total: rooms.filter((r) => r.hotelType === HajjHotelType.MAKKAH).length, occupied: makkahOccupied },
      madinah: { total: rooms.filter((r) => r.hotelType === HajjHotelType.MADINAH).length, occupied: madinahOccupied },
    },
  };
};

const updateBatch = async (agencyId: string, id: string, payload: Partial<ICreateHajjBatchPayload> & { status?: string }) => {
  const batch = await prisma.hajjBatch.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!batch) throw new AppError(status.NOT_FOUND, "Batch not found");

  const updated = await prisma.hajjBatch.update({
    where: { id },
    data: {
      name: payload.name,
      ...(payload.departureDate && { departureDate: new Date(payload.departureDate) }),
      ...(payload.returnDate && { returnDate: new Date(payload.returnDate) }),
      ...(payload.seatCapacity !== undefined && { seatCapacity: payload.seatCapacity }),
      ...(payload.status && { status: payload.status as never }),
    },
  });

  const [withSeats] = await attachSeatCounts(agencyId, [updated]);
  return withSeats;
};

const deleteBatch = async (agencyId: string, id: string) => {
  const batch = await prisma.hajjBatch.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!batch) throw new AppError(status.NOT_FOUND, "Batch not found");

  const [bookings, rooms] = await Promise.all([
    prisma.hajjBooking.count({ where: { agencyId, batchId: id, isDeleted: false } }),
    prisma.hajjRoom.count({ where: { agencyId, batchId: id, isDeleted: false } }),
  ]);

  if (bookings > 0 || rooms > 0) {
    throw new AppError(status.BAD_REQUEST, "This batch has bookings or rooms and cannot be deleted");
  }

  await prisma.hajjBatch.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  return { message: "Batch deleted successfully" };
};

/* --------------------------------- rooms -------------------------------- */

const attachOccupancy = async <T extends { id: string; capacity: number; hotelType: HajjHotelType }>(
  agencyId: string,
  rooms: T[],
) => {
  if (rooms.length === 0) return [];

  const roomIds = rooms.map((r) => r.id);

  const [makkah, madinah] = await Promise.all([
    prisma.hajjBooking.groupBy({
      by: ["makkahRoomId"],
      where: { agencyId, makkahRoomId: { in: roomIds }, ...LIVE_BOOKING },
      _count: { _all: true },
    }),
    prisma.hajjBooking.groupBy({
      by: ["madinahRoomId"],
      where: { agencyId, madinahRoomId: { in: roomIds }, ...LIVE_BOOKING },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map<string, number>();
  for (const row of makkah) if (row.makkahRoomId) counts.set(row.makkahRoomId, row._count._all);
  for (const row of madinah) if (row.madinahRoomId) counts.set(row.madinahRoomId, row._count._all);

  return rooms.map((room) => {
    const occupancy = counts.get(room.id) ?? 0;
    return { ...room, occupancy, availableSlots: Math.max(room.capacity - occupancy, 0) };
  });
};

const createRoom = async (agencyId: string, payload: ICreateHajjRoomPayload) => {
  const batch = await prisma.hajjBatch.findFirst({
    where: { id: payload.batchId, agencyId, isDeleted: false },
  });
  if (!batch) throw new AppError(status.BAD_REQUEST, "Invalid batch for this agency");

  const duplicate = await prisma.hajjRoom.findFirst({
    where: {
      agencyId,
      batchId: payload.batchId,
      hotelType: payload.hotelType,
      roomNumber: { equals: payload.roomNumber, mode: "insensitive" },
      isDeleted: false,
    },
  });
  if (duplicate) {
    throw new AppError(status.CONFLICT, "That room number already exists for this hotel in this batch");
  }

  const room = await prisma.hajjRoom.create({ data: { agencyId, ...payload } });
  const [withOccupancy] = await attachOccupancy(agencyId, [room]);
  return withOccupancy;
};

const getRoomsByBatch = async (agencyId: string, batchId: string) => {
  const rooms = await prisma.hajjRoom.findMany({
    where: { agencyId, batchId, isDeleted: false },
    orderBy: [{ hotelType: "asc" }, { roomNumber: "asc" }],
  });
  return attachOccupancy(agencyId, rooms);
};

const deleteRoom = async (agencyId: string, id: string) => {
  const room = await prisma.hajjRoom.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!room) throw new AppError(status.NOT_FOUND, "Room not found");

  const [withOccupancy] = await attachOccupancy(agencyId, [room]);
  if (withOccupancy && withOccupancy.occupancy > 0) {
    throw new AppError(status.BAD_REQUEST, "Pilgrims are assigned to this room — move them first");
  }

  await prisma.hajjRoom.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  return { message: "Room deleted successfully" };
};

export const HajjPackageBatchRoomService = {
  createPackage,
  getAllPackages,
  updatePackage,
  deletePackage,
  createBatch,
  getAllBatches,
  getBatchSummary,
  updateBatch,
  deleteBatch,
  createRoom,
  getRoomsByBatch,
  deleteRoom,
  attachSeatCounts,
  attachOccupancy,
};

export { LIVE_BOOKING };

