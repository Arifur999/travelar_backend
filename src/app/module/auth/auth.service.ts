import status from "http-status";
import { addDays } from "date-fns";
import { env } from "../../../config/env.js";
import { AgencyStatus, Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { APIError } from "better-auth/api";
import { auth } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import {
  IChangePasswordPayload,
  IForgotPasswordPayload,
  ILoginPayload,
  IRegisterPayload,
  IResetPasswordPayload,
  IUpdateMePayload,
} from "./auth.interface.js";

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
    // Role and tenant are not passed here: they are `input: false` in
    // lib/auth.ts, so better-auth would write its defaults regardless.
    const signUp = await auth.api.signUpEmail({
      body: { name: payload.name, email: payload.email, password: payload.password },
    });

    // The first user of an agency is its admin and needs no email round-trip.
    // This update is what actually makes them one.
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

const updateMe = async (requestUser: IRequestUser, payload: IUpdateMePayload) => {
  await prisma.user.update({ where: { id: requestUser.userId }, data: { name: payload.name } });
  return getMe(requestUser);
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

/**
 * Always answers the same way. Whether an account exists, is blocked, or was
 * deleted must not be learnable from this endpoint; better-auth also fakes the
 * lookup work for unknown addresses so timing does not tell either.
 */
const requestPasswordReset = async (payload: IForgotPasswordPayload) => {
  await auth.api.requestPasswordReset({ body: { email: payload.email } });
  return { message: "If an account exists for that email, a link to reset the password is on its way." };
};

const resetPassword = async (payload: IResetPasswordPayload) => {
  try {
    await auth.api.resetPassword({ body: { token: payload.token, newPassword: payload.newPassword } });
  } catch (error) {
    // Unknown, already used and expired tokens all look the same to the user:
    // the link no longer works and they need a new one.
    if (error instanceof APIError) {
      throw new AppError(status.BAD_REQUEST, "This reset link is invalid or has expired. Request a new one.");
    }
    throw error;
  }
  return { message: "Password reset. Sign in with your new password." };
};

const revokeSession = async (sessionToken: string) => {
  await prisma.session.deleteMany({ where: { token: sessionToken } });
};

export const AuthService = {
  registerAgency,
  verifyCredentials,
  getMe,
  updateMe,
  getMyFeatures,
  changePassword,
  requestPasswordReset,
  resetPassword,
  revokeSession,
};
