import status from "http-status";
import { addDays } from "date-fns";
import { env } from "../../../config/env.js";
import { AgencyStatus, Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { auth } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { IChangePasswordPayload, ILoginPayload, IRegisterPayload } from "./auth.interface.js";

/// Every feature is unlocked during the trial so a new agency can evaluate the
/// whole product before choosing a plan.
const ALL_FEATURES = ["TICKETING", "VISA", "HAJJ_UMRAH", "EXPENSE", "REPORTS", "CRM"] as const;

const registerAgency = async (payload: IRegisterPayload) => {
  const existingUser = await prisma.user.findUnique({ where: { email: payload.email } });
  if (existingUser) {
    throw new AppError(status.CONFLICT, "An account with this email already exists");
  }

  const agency = await prisma.agency.create({
    data: {
      name: payload.agencyName,
      email: payload.email,
      phone: payload.agencyPhone,
      status: AgencyStatus.TRIAL,
      trialEndsAt: addDays(new Date(), env.TRIAL_DAYS),
    },
  });

  try {
    // better-auth owns the user row, so it cannot take part in a Prisma
    // transaction. If it fails, the agency created above has to be removed by
    // hand or a half-registered tenant is left behind.
    const signUp = await auth.api.signUpEmail({
      // The extra columns are declared through better-auth's additionalFields,
      // which its generated body type does not narrow to.
      body: {
        name: payload.name,
        email: payload.email,
        password: payload.password,
        role: Role.AGENCY_ADMIN,
        status: UserStatus.ACTIVE,
        agencyId: agency.id,
        needPasswordChange: false,
        isDeleted: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    // The first user of an agency is its admin and needs no email round-trip.
    await prisma.user.update({
      where: { id: signUp.user.id },
      data: { emailVerified: true, role: Role.AGENCY_ADMIN, agencyId: agency.id },
    });

    return { agency, userId: signUp.user.id };
  } catch (error) {
    await prisma.agency.delete({ where: { id: agency.id } }).catch(() => undefined);

    if (error instanceof AppError) throw error;
    console.error("Failed to create the agency admin:", error);
    throw new AppError(status.INTERNAL_SERVER_ERROR, "Could not complete registration");
  }
};

const verifyCredentials = async (payload: ILoginPayload) => {
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    include: { agency: { include: { plan: true } } },
  });

  if (!user || user.isDeleted) {
    throw new AppError(status.UNAUTHORIZED, "Invalid email or password");
  }
  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError(status.FORBIDDEN, "This account has been deactivated");
  }

  return user;
};

const getMe = async (requestUser: IRequestUser) => {
  const user = await prisma.user.findUnique({
    where: { id: requestUser.userId },
    select: {
      id: true, name: true, email: true, emailVerified: true,
      role: true, status: true, needPasswordChange: true, agencyId: true,
      agency: { include: { plan: true } },
    },
  });

  if (!user) throw new AppError(status.NOT_FOUND, "User not found");
  return user;
};

/// Mirrors checkFeatureAccess so the UI and the API never disagree about what
/// is unlocked. A lapsed trial reports no features even before the nightly job
/// flips the status — the previous implementation reported the full set until
/// the cron caught up.
const getMyFeatures = async (requestUser: IRequestUser) => {
  if (!requestUser.agencyId) {
    throw new AppError(status.FORBIDDEN, "This account is not attached to an agency");
  }

  const agency = await prisma.agency.findFirst({
    where: { id: requestUser.agencyId, isDeleted: false },
    include: { plan: true },
  });

  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");

  const withinTrial =
    agency.status === AgencyStatus.TRIAL &&
    agency.trialEndsAt !== null &&
    agency.trialEndsAt.getTime() > Date.now();

  const subscriptionLive =
    agency.status === AgencyStatus.ACTIVE &&
    (agency.subscriptionEndsAt === null || agency.subscriptionEndsAt.getTime() > Date.now());

  return {
    features: withinTrial ? [...ALL_FEATURES] : subscriptionLive ? agency.plan?.features ?? [] : [],
    isTrial: withinTrial,
    trialEndsAt: agency.trialEndsAt,
    status: agency.status,
    subscriptionEndsAt: agency.subscriptionEndsAt,
    planName: agency.plan?.name ?? null,
  };
};

const changePassword = async (requestUser: IRequestUser, payload: IChangePasswordPayload, headers: Headers) => {
  await auth.api.changePassword({
    body: {
      currentPassword: payload.currentPassword,
      newPassword: payload.newPassword,
      revokeOtherSessions: true,
    },
    headers,
  });

  await prisma.user.update({
    where: { id: requestUser.userId },
    data: { needPasswordChange: false },
  });

  return { message: "Password changed successfully" };
};

const revokeSession = async (sessionToken: string) => {
  await prisma.session.deleteMany({ where: { token: sessionToken } });
};

export const AuthService = {
  registerAgency,
  verifyCredentials,
  getMe,
  getMyFeatures,
  changePassword,
  revokeSession,
};
