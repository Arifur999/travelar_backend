import { NextFunction, Request, Response } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";
import { redisService } from "../lib/redis.js";

interface RateLimitOptions {
  scope: string;
  windowSeconds: number;
  max: number;
  message?: string;
}

const getClientIp = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0]!.trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
};

export const rateLimit = ({ scope, windowSeconds, max, message }: RateLimitOptions) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `ratelimit:${scope}:${getClientIp(req)}`;
    const count = await redisService.incrementWithExpiry(key, windowSeconds);

    // null => Redis unavailable. Fail OPEN: blocking every request because the
    // cache is down is a worse outage than briefly unthrottled auth.
    if (count !== null && count > max) {
      res.setHeader("Retry-After", String(windowSeconds));
      return next(
        new AppError(
          status.TOO_MANY_REQUESTS,
          message ?? "Too many requests. Please try again later.",
        ),
      );
    }

    next();
  };
};

export const authRateLimiter = rateLimit({
  scope: "auth",
  windowSeconds: 15 * 60,
  max: 20,
  message: "Too many attempts. Please wait a few minutes and try again.",
});

export const publicSubmitRateLimiter = rateLimit({
  scope: "public-submit",
  windowSeconds: 60 * 60,
  max: 5,
  message: "You've submitted too many times recently. Please try again later.",
});
