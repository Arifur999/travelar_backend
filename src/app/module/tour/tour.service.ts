import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { TourBookingStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { tourPackageFilterableFields, tourPackageSearchableFields } from "./tour.constant.js";
import { ICreateTourPackagePayload, IUpdateTourPackagePayload } from "./tour.interface.js";

const toNumber = PostingService.toNumber;

/// A cancelled booking frees its seats and contributes no revenue — the
/// convention this module follows everywhere, matching Hajj.
export const LIVE_BOOKING = {
  isDeleted: false,
  status: { not: TourBookingStatus.CANCELLED },
} as const;

/* --------------------------------- tours --------------------------------- */

/**
 * Seats sold are counted, never stored, so a cancellation frees one the moment
 * it happens. Travellers are summed rather than bookings counted: one booking
 * for a family of four takes four seats.
 *
 * One grouped query for a whole page, not one per tour.
 */
const attachSeatCounts = async <T extends { id: string; seatCapacity: number | null }>(
  agencyId: string,
  packages: T[],
) => {
  if (packages.length === 0) return [];

  const counts = await prisma.tourBooking.groupBy({
    by: ["packageId"],
    where: { agencyId, packageId: { in: packages.map((p) => p.id) }, ...LIVE_BOOKING },
    _sum: { travellers: true },
    _count: { _all: true },
  });

  const soldByPackage = new Map(
    counts.map((row) => [row.packageId, { seats: row._sum.travellers ?? 0, bookings: row._count._all }]),
  );

  return packages.map((tourPackage) => {
    const sold = soldByPackage.get(tourPackage.id) ?? { seats: 0, bookings: 0 };
    return {
      ...tourPackage,
      bookingsCount: sold.bookings,
      seatsSold: sold.seats,
      // Null capacity means the tour has no fixed limit, which is not the same
      // as being full — the difference matters to whoever is selling.
      seatsLeft: tourPackage.seatCapacity === null ? null : tourPackage.seatCapacity - sold.seats,
    };
  });
};

const createPackage = async (
  agencyId: string,
  payload: ICreateTourPackagePayload,
  user: IRequestUser,
) => {
  const duplicate = await prisma.tourPackage.findFirst({
    where: { agencyId, name: { equals: payload.name, mode: "insensitive" }, isDeleted: false },
  });
  if (duplicate) throw new AppError(status.CONFLICT, "A tour with this name already exists");

  if (payload.departureDate && payload.returnDate) {
    if (new Date(payload.returnDate) < new Date(payload.departureDate)) {
      throw new AppError(status.BAD_REQUEST, "The return date cannot be before the departure");
    }
  }

  return prisma.tourPackage.create({
    data: {
      agencyId,
      name: payload.name,
      destination: payload.destination,
      ...(payload.departureDate && { departureDate: new Date(payload.departureDate) }),
      ...(payload.returnDate && { returnDate: new Date(payload.returnDate) }),
      durationDays: payload.durationDays,
      seatCapacity: payload.seatCapacity,
      pricePerPerson: new Prisma.Decimal(payload.pricePerPerson),
      costPerPerson: new Prisma.Decimal(payload.costPerPerson ?? 0),
      inclusions: payload.inclusions,
      description: payload.description,
      createdById: user.userId,
    },
  });
};

const getAllPackages = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.TourPackageGetPayload<object>,
    Prisma.TourPackageWhereInput,
    Prisma.TourPackageInclude
  >(prisma.tourPackage, query, {
    searchableFields: tourPackageSearchableFields,
    filterableFields: tourPackageFilterableFields,
  });

  const result = await queryBuilder
    .search()
    .filter()
    .where({ agencyId, isDeleted: false })
    .paginate()
    .sort()
    .fields()
    .execute();

  return { ...result, data: await attachSeatCounts(agencyId, result.data) };
};

const getPackageById = async (agencyId: string, id: string) => {
  const tourPackage = await prisma.tourPackage.findFirst({
    where: { id, agencyId, isDeleted: false },
  });
  if (!tourPackage) throw new AppError(status.NOT_FOUND, "Tour not found");

  const [withSeats] = await attachSeatCounts(agencyId, [tourPackage]);

  const [byStatus, revenue, collected] = await Promise.all([
    prisma.tourBooking.groupBy({
      by: ["status"],
      where: { agencyId, packageId: id, isDeleted: false },
      _count: { _all: true },
    }),
    prisma.tourBooking.aggregate({
      where: { agencyId, packageId: id, ...LIVE_BOOKING },
      _sum: { sellAmount: true, costAmount: true },
    }),
    prisma.tourPayment.aggregate({
      where: { agencyId, booking: { packageId: id, ...LIVE_BOOKING } },
      _sum: { amount: true },
    }),
  ]);

  const totalRevenue = toNumber(revenue._sum.sellAmount);
  const totalCost = toNumber(revenue._sum.costAmount);
  const totalCollected = toNumber(collected._sum.amount);

  return {
    ...withSeats,
    statusBreakdown: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    totalCollected,
    totalDue: totalRevenue - totalCollected,
  };
};

const updatePackage = async (agencyId: string, id: string, payload: IUpdateTourPackagePayload) => {
  const found = await prisma.tourPackage.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!found) throw new AppError(status.NOT_FOUND, "Tour not found");

  const departureDate = payload.departureDate ? new Date(payload.departureDate) : found.departureDate;
  const returnDate = payload.returnDate ? new Date(payload.returnDate) : found.returnDate;
  if (departureDate && returnDate && returnDate < departureDate) {
    throw new AppError(status.BAD_REQUEST, "The return date cannot be before the departure");
  }

  // Capacity cannot be cut below what is already sold — those seats exist.
  if (payload.seatCapacity !== undefined) {
    const sold = await prisma.tourBooking.aggregate({
      where: { agencyId, packageId: id, ...LIVE_BOOKING },
      _sum: { travellers: true },
    });
    const seatsSold = sold._sum.travellers ?? 0;
    if (payload.seatCapacity < seatsSold) {
      throw new AppError(
        status.BAD_REQUEST,
        `${seatsSold} seats are already sold on this tour`,
      );
    }
  }

  await prisma.tourPackage.update({
    where: { id },
    data: {
      name: payload.name,
      destination: payload.destination,
      ...(payload.departureDate && { departureDate }),
      ...(payload.returnDate && { returnDate }),
      ...(payload.durationDays !== undefined && { durationDays: payload.durationDays }),
      ...(payload.seatCapacity !== undefined && { seatCapacity: payload.seatCapacity }),
      ...(payload.pricePerPerson !== undefined && {
        pricePerPerson: new Prisma.Decimal(payload.pricePerPerson),
      }),
      ...(payload.costPerPerson !== undefined && {
        costPerPerson: new Prisma.Decimal(payload.costPerPerson),
      }),
      ...(payload.inclusions !== undefined && { inclusions: payload.inclusions }),
      ...(payload.description !== undefined && { description: payload.description }),
      ...(payload.status !== undefined && { status: payload.status }),
    },
  });

  return getPackageById(agencyId, id);
};

/// Refused while bookings still reference it — deleting one would orphan them.
/// Closing the tour is what an agency wants when it simply stops selling.
const deletePackage = async (agencyId: string, id: string) => {
  const found = await prisma.tourPackage.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!found) throw new AppError(status.NOT_FOUND, "Tour not found");

  const bookings = await prisma.tourBooking.count({
    where: { agencyId, packageId: id, isDeleted: false },
  });
  if (bookings > 0) {
    throw new AppError(status.BAD_REQUEST, "This tour has bookings and cannot be deleted");
  }

  await prisma.tourPackage.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return { message: "Tour deleted successfully" };
};

/* -------------------------------- summary -------------------------------- */

/** The module's own dashboard: what is selling, what is owed, what it earns. */
const getSummary = async (agencyId: string) => {
  const [tours, bookings, byStatus, revenue, collected, upcoming] = await Promise.all([
    prisma.tourPackage.count({ where: { agencyId, isDeleted: false } }),
    prisma.tourBooking.count({ where: { agencyId, ...LIVE_BOOKING } }),
    prisma.tourBooking.groupBy({
      by: ["status"],
      where: { agencyId, isDeleted: false },
      _count: { _all: true },
    }),
    prisma.tourBooking.aggregate({
      where: { agencyId, ...LIVE_BOOKING },
      _sum: { sellAmount: true, costAmount: true, travellers: true },
    }),
    prisma.tourPayment.aggregate({
      where: { agencyId, booking: { ...LIVE_BOOKING } },
      _sum: { amount: true },
    }),
    prisma.tourPackage.findMany({
      where: {
        agencyId,
        isDeleted: false,
        status: "OPEN",
        departureDate: { gte: new Date() },
      },
      orderBy: { departureDate: "asc" },
      take: 5,
    }),
  ]);

  const totalRevenue = toNumber(revenue._sum.sellAmount);
  const totalCost = toNumber(revenue._sum.costAmount);
  const totalCollected = toNumber(collected._sum.amount);

  return {
    totalTours: tours,
    totalBookings: bookings,
    totalTravellers: revenue._sum.travellers ?? 0,
    statusBreakdown: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    totalCollected,
    totalDue: totalRevenue - totalCollected,
    upcoming: await attachSeatCounts(agencyId, upcoming),
  };
};

export const TourService = {
  attachSeatCounts,
  createPackage,
  getAllPackages,
  getPackageById,
  updatePackage,
  deletePackage,
  getSummary,
};
