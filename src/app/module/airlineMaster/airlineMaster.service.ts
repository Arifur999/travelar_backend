import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";

interface IAirlinePayload {
  name?: string;
  shortCode?: string;
  logoUrl?: string;
  remark?: string;
}

/// Short code is the real key an agency types (BS, BG, EK), so it is checked
/// case-insensitively and stored uppercase.
const assertUnique = async (agencyId: string, name?: string, shortCode?: string, exceptId?: string) => {
  if (name) {
    const clash = await prisma.airlineMaster.findFirst({
      where: { agencyId, name: { equals: name, mode: "insensitive" }, ...(exceptId && { id: { not: exceptId } }) },
    });
    if (clash) throw new AppError(status.CONFLICT, "An airline with this name already exists");
  }
  if (shortCode) {
    const clash = await prisma.airlineMaster.findFirst({
      where: {
        agencyId,
        shortCode: { equals: shortCode.toUpperCase(), mode: "insensitive" },
        ...(exceptId && { id: { not: exceptId } }),
      },
    });
    if (clash) throw new AppError(status.CONFLICT, "An airline with this short code already exists");
  }
};

const createAirline = async (agencyId: string, payload: IAirlinePayload, user: IRequestUser) => {
  await assertUnique(agencyId, payload.name, payload.shortCode);

  return prisma.airlineMaster.create({
    data: {
      agencyId,
      name: payload.name!,
      shortCode: payload.shortCode!.toUpperCase(),
      logoUrl: payload.logoUrl,
      remark: payload.remark,
      createdById: user.userId,
    },
  });
};

const getAllAirlines = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.AirlineMasterGetPayload<object>,
    Prisma.AirlineMasterWhereInput,
    Prisma.AirlineMasterInclude
  >(prisma.airlineMaster, query, {
    searchableFields: ["name", "shortCode", "remark"],
    filterableFields: ["name", "shortCode"],
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

const getAirlineById = async (agencyId: string, id: string) => {
  const airline = await prisma.airlineMaster.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!airline) throw new AppError(status.NOT_FOUND, "Airline not found");
  return airline;
};

const updateAirline = async (agencyId: string, id: string, payload: IAirlinePayload) => {
  await getAirlineById(agencyId, id);
  await assertUnique(agencyId, payload.name, payload.shortCode, id);

  return prisma.airlineMaster.update({
    where: { id },
    data: {
      name: payload.name,
      ...(payload.shortCode && { shortCode: payload.shortCode.toUpperCase() }),
      logoUrl: payload.logoUrl,
      remark: payload.remark,
    },
  });
};

/// Refused while tickets still reference it — those rows would otherwise name
/// an airline nobody can look up.
const deleteAirline = async (agencyId: string, id: string) => {
  await getAirlineById(agencyId, id);

  const inUse = await prisma.ticket.count({ where: { agencyId, airlineId: id, isDeleted: false } });
  if (inUse > 0) {
    throw new AppError(status.BAD_REQUEST, "This airline is used by existing tickets and cannot be deleted");
  }

  await prisma.airlineMaster.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  return { message: "Airline deleted successfully" };
};

export const AirlineMasterService = {
  createAirline,
  getAllAirlines,
  getAirlineById,
  updateAirline,
  deleteAirline,
};
