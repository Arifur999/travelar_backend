import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";

interface IRoutePayload {
  name?: string;
  remark?: string;
}

/**
 * A route is the sector string as the agency writes it — "DAC-SIN", or
 * "YYZ-DAC-YYZ" for a multi-leg return. Kept as master data so analytics group
 * by a real row rather than by whatever string someone typed that day.
 */
const assertUnique = async (agencyId: string, name?: string, exceptId?: string) => {
  if (!name) return;

  const clash = await prisma.routeMaster.findFirst({
    where: {
      agencyId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });

  if (clash) throw new AppError(status.CONFLICT, "This route already exists");
};

const createRoute = async (agencyId: string, payload: IRoutePayload, user: IRequestUser) => {
  await assertUnique(agencyId, payload.name);

  return prisma.routeMaster.create({
    data: {
      agencyId,
      name: payload.name as string,
      remark: payload.remark,
      createdById: user.userId,
    },
  });
};

const getAllRoutes = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.RouteMasterGetPayload<object>,
    Prisma.RouteMasterWhereInput,
    Prisma.RouteMasterInclude
  >(prisma.routeMaster, query, {
    searchableFields: ["name", "remark"],
    filterableFields: ["name"],
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

const getRouteById = async (agencyId: string, id: string) => {
  const route = await prisma.routeMaster.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!route) throw new AppError(status.NOT_FOUND, "Route not found");
  return route;
};

const updateRoute = async (agencyId: string, id: string, payload: IRoutePayload) => {
  await getRouteById(agencyId, id);
  await assertUnique(agencyId, payload.name, id);

  return prisma.routeMaster.update({
    where: { id },
    data: { name: payload.name, remark: payload.remark },
  });
};

/// Refused while tickets still reference it.
const deleteRoute = async (agencyId: string, id: string) => {
  await getRouteById(agencyId, id);

  const inUse = await prisma.ticket.count({ where: { agencyId, routeId: id, isDeleted: false } });
  if (inUse > 0) {
    throw new AppError(
      status.BAD_REQUEST,
      "This route is used by existing tickets and cannot be deleted",
    );
  }

  await prisma.routeMaster.update({
    where: { id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  return { message: "Route deleted successfully" };
};

export const RouteMasterService = {
  createRoute,
  getAllRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
};
