import { timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response, Router } from "express";
import status from "http-status";
import { env } from "../../../config/env.js";
import AppError from "../../errorHelpers/AppError.js";
import { InternalController } from "./internal.controller.js";

const router = Router();

/**
 * For an external scheduler (a cron service, a platform's scheduled job) on
 * deployments where the in-process schedule is off. No user session: the
 * caller sends the shared CRON_SECRET in `x-cron-secret`.
 *
 * With CRON_SECRET unset the routes answer 404, as if they did not exist —
 * an empty secret must never mean "anyone may call this".
 */
const requireCronSecret = (req: Request, res: Response, next: NextFunction) => {
  if (!env.CRON_SECRET) {
    return next(new AppError(status.NOT_FOUND, "Route not found"));
  }

  const provided = Buffer.from(req.get("x-cron-secret") ?? "");
  const expected = Buffer.from(env.CRON_SECRET);

  // Constant-time, so response timing does not leak how much of a guess matched.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return next(new AppError(status.UNAUTHORIZED, "Invalid cron secret"));
  }

  next();
};

router.use(requireCronSecret);

router.post("/jobs/subscription-lifecycle", InternalController.runSubscriptionLifecycle);

export const InternalRoutes = router;
