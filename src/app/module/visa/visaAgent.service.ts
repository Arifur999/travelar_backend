import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";

interface IVisaAgentPayload {
  name?: string;
  type?: string;
  contact?: string;
  email?: string;
  address?: string;
  note?: string;
}

/// An embassy, consultancy or handling agent a visa case can be routed through.
const assertNameFree = async (agencyId: string, name?: string, exceptId?: string) => {
  if (!name) return;

  const clash = await prisma.visaAgent.findFirst({
    where: {
      agencyId,
      name: { equals: name, mode: "insensitive" },
      isDeleted: false,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });

  if (clash) throw new AppError(status.CONFLICT, "An agent with this name already exists");
};

const createVisaAgent = async (agencyId: string, payload: IVisaAgentPayload) => {
  await assertNameFree(agencyId, payload.name);

  return prisma.visaAgent.create({
    data: {
      agencyId,
      name: payload.name as string,
      type: payload.type,
      contact: payload.contact,
      email: payload.email,
      address: payload.address,
      note: payload.note,
    },
  });
};

const getAllVisaAgents = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.VisaAgentGetPayload<object>,
    Prisma.VisaAgentWhereInput,
    Prisma.VisaAgentInclude
  >(prisma.visaAgent, query, {
    searchableFields: ["name", "type", "contact", "email", "address"],
    filterableFields: ["name", "type"],
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

const getVisaAgentById = async (agencyId: string, id: string) => {
  const agent = await prisma.visaAgent.findFirst({ where: { id, agencyId, isDeleted: false } });
  if (!agent) throw new AppError(status.NOT_FOUND, "Visa agent not found");
  return agent;
};

const updateVisaAgent = async (agencyId: string, id: string, payload: IVisaAgentPayload) => {
  await getVisaAgentById(agencyId, id);
  await assertNameFree(agencyId, payload.name, id);

  return prisma.visaAgent.update({ where: { id }, data: payload });
};

/// Refused while live cases still route through it.
const deleteVisaAgent = async (agencyId: string, id: string) => {
  await getVisaAgentById(agencyId, id);

  const inUse = await prisma.visaCase.count({ where: { agencyId, visaAgentId: id, isDeleted: false } });
  if (inUse > 0) {
    throw new AppError(
      status.BAD_REQUEST,
      "Visa cases are routed through this agent and it cannot be deleted",
    );
  }

  await prisma.visaAgent.update({ where: { id }, data: { isDeleted: true, deletedAt: new Date() } });
  return { message: "Visa agent deleted successfully" };
};

export const VisaAgentService = {
  createVisaAgent,
  getAllVisaAgents,
  getVisaAgentById,
  updateVisaAgent,
  deleteVisaAgent,
};
