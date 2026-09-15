import { NextFunction, Request, Response } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";
import { redisService } from "../lib/redis.js";

interface RateLimitOptions {
  scope: string;
  windowSeconds: number;
  max: number;
  message?: string;
  /**
   * What one counter tracks. Defaults to the client IP. Return undefined to
   * skip counting this request (e.g. a body without the field to key on —
   * validation rejects it next anyway).
   */
  keyBy?: (req: Request) => string | undefined;
}

/**
 * `req.ip`, never the raw X-Forwarded-For header. The header is whatever the
 * client sends, and reading its first entry meant an attacker could put a new
 * fake address on every login attempt and never reach the limit. With
 * `trust proxy` set in app.ts, Express derives req.ip from the hop our own
 * proxy appended, which a client cannot forge.
 */
const getClientIp = (req: Request): string => req.ip || req.socket.remoteAddress || "unknown";

/**
 * Fixed-window counters kept in this process, used whenever Redis cannot
 * count — unset, or down.
 *
 * The limiter used to fail open instead, which is right for a brief Redis
 * outage but meant a deployment without REDIS_URL (the default docker stack)
 * had no login throttling at all: unlimited password guessing. Counting in
 * memory keeps a limit in force. With several API instances each keeps its own
 * count, so the effective limit is `max` per instance — looser, still bounded.
 */
const memoryWindows = new Map<string, { count: number; resetAt: number }>();
const MEMORY_SWEEP_THRESHOLD = 10_000;

const incrementInMemory = (key: string, windowSeconds: number): number => {
  const now = Date.now();

  // Expired windows are dropped lazily, and only once the map is large, so a
  // flood of distinct addresses cannot grow it without bound.
  if (memoryWindows.size > MEMORY_SWEEP_THRESHOLD) {
    for (const [storedKey, window] of memoryWindows) {
      if (window.resetAt <= now) memoryWindows.delete(storedKey);
    }
  }

  const current = memoryWindows.get(key);
  if (!current || current.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return 1;
  }

  current.count += 1;
  return current.count;
};

export const rateLimit = ({ scope, windowSeconds, max, message, keyBy = getClientIp }: RateLimitOptions) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const subject = keyBy(req);
    if (!subject) return next();

    const key = `ratelimit:${scope}:${subject}`;
    const count =
      (await redisService.incrementWithExpiry(key, windowSeconds)) ??
      incrementInMemory(key, windowSeconds);

    if (count > max) {
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

/**
 * Login attempts per account, whatever address they come from.
 *
 * The per-IP limiter above is only as good as the address it sees, and the IP
 * can be made up by any client that reaches the API or the web server without
 * a proxy in front that overwrites X-Forwarded-For. Counting per email caps
 * guessing against any one account regardless. The trade-off — someone can
 * spend a victim's attempts and lock them out for the window — is the usual
 * one, and the window is short.
 */
export const loginAccountRateLimiter = rateLimit({
  scope: "login-account",
  windowSeconds: 15 * 60,
  max: 10,
  message: "Too many sign-in attempts for this account. Please wait a few minutes and try again.",
  keyBy: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : undefined;
  },
});

/**
 * Reset emails per address, whoever asks. Without it anyone could send a
 * victim an endless stream of reset emails. Every address gets the same 429
 * once over the limit, existing account or not, so it reveals nothing.
 */
export const passwordResetAccountRateLimiter = rateLimit({
  scope: "password-reset-account",
  windowSeconds: 60 * 60,
  max: 3,
  message: "Too many reset requests for this email. Please wait an hour and try again.",
  keyBy: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : undefined;
  },
});

export const publicSubmitRateLimiter = rateLimit({
  scope: "public-submit",
  windowSeconds: 60 * 60,
  max: 5,
  message: "You've submitted too many times recently. Please try again later.",
});
