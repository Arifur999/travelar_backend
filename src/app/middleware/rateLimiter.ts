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

/**
 * `req.ip`, never the raw X-Forwarded-For header. The header is whatever the
 * client sends, and reading its first entry meant an attacker could put a new
 * fake address on every login attempt and never reach the limit. With
 * `trust proxy` set in app.ts, Express derives req.ip from the hop our own
 * proxy appended, which a client cannot forge.
 */
const getClientIp = (req: Request): string => req.ip || req.socket.remoteAddress || "unknown";

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
