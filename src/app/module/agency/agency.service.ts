import status from "http-status";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IUpdateAgencyProfilePayload } from "./agency.interface.js";

/**
 * The tenant's own view of itself. Billing state is included read-only so the
 * settings page can show it; changing it goes through billing or the operator.
 */
const getProfile = async (agencyId: string) => {
  const [agency, members, owner] = await Promise.all([
    prisma.agency.findFirst({
      where: { id: agencyId, isDeleted: false },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        logo: true,
        status: true,
        trialEndsAt: true,
        subscriptionEndsAt: true,
        createdAt: true,
        plan: { select: { id: true, name: true, features: true } },
      },
    }),
    prisma.user.groupBy({
      by: ["role", "status"],
      where: { agencyId, isDeleted: false },
      _count: { _all: true },
    }),
    // Same rule as TeamService.getOwnerId: the earliest admin still on the
    // books. Returned so the team page can tell whether the viewer is the owner
    // even when the owner is not on the page of rows it is showing.
    prisma.user.findFirst({
      where: { agencyId, role: Role.AGENCY_ADMIN, isDeleted: false },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);

  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");

  const count = (predicate: (row: (typeof members)[number]) => boolean) =>
    members.filter(predicate).reduce((sum, row) => sum + row._count._all, 0);

  return {
    ...agency,
    team: {
      total: count(() => true),
      admins: count((row) => row.role === Role.AGENCY_ADMIN),
      staff: count((row) => row.role === Role.AGENCY_STAFF),
      blocked: count((row) => row.status === UserStatus.BLOCKED),
      ownerId: owner?.id ?? null,
    },
  };
};

const updateProfile = async (agencyId: string, payload: IUpdateAgencyProfilePayload) => {
  const agency = await prisma.agency.findFirst({ where: { id: agencyId, isDeleted: false }, select: { id: true } });
  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");

  // Only the contact columns. Status, plan and dates are never accepted here
  // even if a client sends them — zod strips unknown keys, and this list is
  // the second line.
  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      address: payload.address,
      logo: payload.logo,
    },
  });

  return getProfile(agencyId);
};

export const AgencyService = { getProfile, updateProfile };
