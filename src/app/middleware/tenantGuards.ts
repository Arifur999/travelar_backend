import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { PlanFeature, Role } from "../../generated/prisma/enums.js";
import { AgencyStatus } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { prisma } from "../lib/prisma.js";

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Loads the caller's agency once and caches it on the request, so the two
 * guards below don't each hit the database.
 */
const loadAgency = async (agencyId: string) => {
  const agency = await prisma.agency.findFirst({
    where: { id: agencyId, isDeleted: false },
    include: { plan: true },
  });

  if (!agency) {
    throw new AppError(status.NOT_FOUND, "Agency not found");
  }

  return agency;
};

/** True while the agency is inside its trial window. */
const isWithinTrial = (status_: AgencyStatus, trialEndsAt: Date | null) =>
  status_ === AgencyStatus.TRIAL && trialEndsAt !== null && trialEndsAt.getTime() > Date.now();

/**
 * A trial that has run out, or an expired/suspended agency, drops to read-only:
 * GET still works so nobody is locked out of their own data, but every write is
 * refused until a super admin activates the agency or a subscription renews.
 */
export const requireActiveSubscription = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // The platform operator is not a tenant and is never gated.
    if (req.user.role === Role.SUPER_ADMIN) {
      return next();
    }
    if (!req.user.agencyId) {
      throw new AppError(status.FORBIDDEN, "This account is not attached to an agency.");
    }
    if (!WRITE_METHODS.includes(req.method)) {
      return next();
    }

    const agency = await loadAgency(req.user.agencyId);

    if (agency.status === AgencyStatus.ACTIVE) {
      const stillPaid =
        agency.subscriptionEndsAt === null || agency.subscriptionEndsAt.getTime() > Date.now();
      if (stillPaid) return next();
    }

    if (isWithinTrial(agency.status, agency.trialEndsAt)) {
      return next();
    }

    throw new AppError(
      status.FORBIDDEN,
      "Your subscription is not active. You can still view your data, but changes are disabled until the agency is reactivated.",
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    next(error);
  }
};

/**
 * Gates a module behind a plan feature. Every feature is unlocked while the
 * agency is still inside its trial, so a new signup can evaluate the whole
 * product before choosing a plan.
 */
export const checkFeatureAccess =
  (feature: PlanFeature) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user.role === Role.SUPER_ADMIN) {
        return next();
      }
      if (!req.user.agencyId) {
        throw new AppError(status.FORBIDDEN, "This account is not attached to an agency.");
      }

      const agency = await loadAgency(req.user.agencyId);

      if (isWithinTrial(agency.status, agency.trialEndsAt)) {
        return next();
      }

      if (!agency.plan) {
        throw new AppError(
          status.FORBIDDEN,
          "Your agency has no active plan. Upgrade to use this module.",
        );
      }

      if (!agency.plan.features.includes(feature)) {
        throw new AppError(
          status.FORBIDDEN,
          `Your current plan does not include the ${feature} module. Upgrade to unlock it.`,
        );
      }

      next();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      next(error);
    }
  };

/**
 * The tenant key for the current request. Throws rather than returning null, so
 * a service can never accidentally run an unscoped query.
 */
export const requireAgencyId = (req: Request): string => {
  if (!req.user.agencyId) {
    throw new AppError(status.FORBIDDEN, "This account is not attached to an agency.");
  }
  return req.user.agencyId;
};
