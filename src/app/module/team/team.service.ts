import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { auth } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { QueryBuilder } from "../../utils/QueryBuilder.js";
import { teamFilterableFields, teamMemberSelect, teamSearchableFields } from "./team.constant.js";
import {
  ICreateMemberPayload,
  IResetMemberPasswordPayload,
  IUpdateMemberPayload,
  IUpdateMemberStatusPayload,
} from "./team.interface.js";

type TeamMemberRow = Prisma.UserGetPayload<{ select: typeof teamMemberSelect }>;

const pickMember = (user: TeamMemberRow, ownerId: string | null) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  needPasswordChange: user.needPasswordChange,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  isOwner: user.id === ownerId,
});

/**
 * The agency's owner is its earliest admin still on the books — normally the
 * person who registered it. Derived rather than stored, so there is no column
 * to fall out of step when a super admin removes someone.
 */
const getOwnerId = async (agencyId: string) => {
  const owner = await prisma.user.findFirst({
    where: { agencyId, role: Role.AGENCY_ADMIN, isDeleted: false },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return owner?.id ?? null;
};

/**
 * Deleting the session rows is what makes a block, removal, role change or
 * password reset take effect now: checkAuth loads the session from the DB on
 * every request, and the refresh endpoint needs a live one to mint a token.
 */
const revokeSessions = (userId: string) => prisma.session.deleteMany({ where: { userId } });

/**
 * Who may act on whom. The previous implementation only stopped an admin
 * targeting themselves, so any admin could demote, block or delete any other
 * admin — including the one who owns the agency.
 *
 *  - nobody changes their own role, status or password from here;
 *  - the owner cannot be changed from inside the agency at all;
 *  - only the owner can act on another admin, or make someone an admin.
 */
const assertCanManage = async (
  agencyId: string,
  actor: IRequestUser,
  memberId: string,
  options: { grantsAdmin?: boolean } = {},
) => {
  const member = await prisma.user.findFirst({
    where: { id: memberId, agencyId, isDeleted: false },
    select: teamMemberSelect,
  });

  // 404 rather than 403 for another tenant's user, so an id from elsewhere
  // cannot be confirmed to exist.
  if (!member) throw new AppError(status.NOT_FOUND, "Team member not found");

  if (member.id === actor.userId) {
    throw new AppError(
      status.BAD_REQUEST,
      "You cannot change your own role, status or password here. Use your profile page instead.",
    );
  }

  const ownerId = await getOwnerId(agencyId);
  const actorIsOwner = actor.userId === ownerId;

  if (member.id === ownerId) {
    throw new AppError(status.FORBIDDEN, "The agency owner's account can only be changed by platform support.");
  }
  if (member.role === Role.AGENCY_ADMIN && !actorIsOwner) {
    throw new AppError(status.FORBIDDEN, "Only the agency owner can manage other admins.");
  }
  if (options.grantsAdmin && !actorIsOwner) {
    throw new AppError(status.FORBIDDEN, "Only the agency owner can make someone an admin.");
  }

  return { member, ownerId };
};

const createMember = async (agencyId: string, actor: IRequestUser, payload: ICreateMemberPayload) => {
  const role = payload.role ?? Role.AGENCY_STAFF;

  if (role === Role.AGENCY_ADMIN && actor.userId !== (await getOwnerId(agencyId))) {
    throw new AppError(status.FORBIDDEN, "Only the agency owner can add another admin.");
  }

  // Emails are unique across the whole platform. The message does not say
  // which agency holds it — that would leak another tenant's staff list.
  const existing = await prisma.user.findUnique({ where: { email: payload.email }, select: { id: true } });
  if (existing) {
    throw new AppError(status.CONFLICT, "An account with this email already exists");
  }

  // better-auth owns the user and credential rows, so this cannot share a
  // Prisma transaction. Role and tenant are `input: false` there and are set
  // by the update below; if that fails the half-made user is removed.
  const signUp = await auth.api.signUpEmail({
    body: { name: payload.name, email: payload.email, password: payload.password },
  });

  try {
    const member = await prisma.user.update({
      where: { id: signUp.user.id },
      data: {
        role,
        agencyId,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        // The admin chose this password, so the member must replace it before
        // doing anything else — the frontend proxy enforces the redirect.
        needPasswordChange: true,
      },
      select: teamMemberSelect,
    });

    // signUpEmail signs the new user in. Nobody holds that session, so drop it.
    await revokeSessions(member.id);

    return pickMember(member, await getOwnerId(agencyId));
  } catch (error) {
    await prisma.user.delete({ where: { id: signUp.user.id } }).catch(() => undefined);
    throw error;
  }
};

const getAllMembers = async (agencyId: string, query: IqueryParams) => {
  const queryBuilder = new QueryBuilder<
    Prisma.UserGetPayload<object>,
    Prisma.UserWhereInput,
    Prisma.UserInclude
  >(prisma.user, query, {
    searchableFields: teamSearchableFields,
    filterableFields: teamFilterableFields,
  });

  const [result, ownerId] = await Promise.all([
    queryBuilder
      .search()
      .filter()
      .where({ agencyId, isDeleted: false })
      .paginate()
      .sort()
      .execute(),
    getOwnerId(agencyId),
  ]);

  return { data: result.data.map((user) => pickMember(user, ownerId)), meta: result.meta };
};

const getMemberById = async (agencyId: string, id: string) => {
  const member = await prisma.user.findFirst({
    where: { id, agencyId, isDeleted: false },
    select: teamMemberSelect,
  });
  if (!member) throw new AppError(status.NOT_FOUND, "Team member not found");

  return pickMember(member, await getOwnerId(agencyId));
};

const updateMember = async (
  agencyId: string,
  actor: IRequestUser,
  id: string,
  payload: IUpdateMemberPayload,
) => {
  const { member, ownerId } = await assertCanManage(agencyId, actor, id, {
    grantsAdmin: payload.role === Role.AGENCY_ADMIN,
  });

  const roleChanged = payload.role !== undefined && payload.role !== member.role;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id },
      data: { name: payload.name, role: payload.role },
      select: teamMemberSelect,
    });

    // The access token carries the role, and the proxy routes on it. Signing
    // the member out means their next login carries the new one.
    if (roleChanged) await tx.session.deleteMany({ where: { userId: id } });

    return row;
  });

  return pickMember(updated, ownerId);
};

const updateMemberStatus = async (
  agencyId: string,
  actor: IRequestUser,
  id: string,
  payload: IUpdateMemberStatusPayload,
) => {
  const { ownerId } = await assertCanManage(agencyId, actor, id);

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id },
      data: { status: payload.status },
      select: teamMemberSelect,
    });

    if (payload.status === UserStatus.BLOCKED) {
      await tx.session.deleteMany({ where: { userId: id } });
    }

    return row;
  });

  return pickMember(updated, ownerId);
};

const resetMemberPassword = async (
  agencyId: string,
  actor: IRequestUser,
  id: string,
  payload: IResetMemberPasswordPayload,
) => {
  await assertCanManage(agencyId, actor, id);

  // Hashed with better-auth's own hasher, so its sign-in can verify it.
  const context = await auth.$context;
  const hash = await context.password.hash(payload.newPassword);

  await prisma.$transaction(async (tx) => {
    const credential = await tx.account.updateMany({
      where: { userId: id, providerId: "credential" },
      data: { password: hash },
    });
    if (credential.count === 0) {
      throw new AppError(status.BAD_REQUEST, "This member has no password to reset");
    }

    await tx.user.update({ where: { id }, data: { needPasswordChange: true } });
    await tx.session.deleteMany({ where: { userId: id } });
  });

  return { message: "Password reset. They will be asked to choose a new one when they sign in." };
};

const removeMember = async (agencyId: string, actor: IRequestUser, id: string) => {
  await assertCanManage(agencyId, actor, id);

  // Soft delete: tickets, payments and status history still point at this
  // user as the person who recorded them, and that trail has to survive.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), status: UserStatus.DELETED },
    });
    await tx.session.deleteMany({ where: { userId: id } });
  });

  return { message: "Team member removed" };
};

export const TeamService = {
  createMember,
  getAllMembers,
  getMemberById,
  updateMember,
  updateMemberStatus,
  resetMemberPassword,
  removeMember,
};
