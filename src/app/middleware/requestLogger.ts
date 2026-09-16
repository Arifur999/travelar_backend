import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";

/**
 * Gives every request an id, returns it in `x-request-id`, and logs one line
 * when it finishes.
 *
 * The id ties an access line, any error line and the user's error message
 * together: someone reports "it said something went wrong", quotes the id from
 * the response, and the logs say exactly which request that was.
 */

// An inbound id is honoured so a trace started at the proxy or the web app
// continues here — but only if it is short and boring. Log fields must never
// carry whatever a client felt like sending.
const SAFE_ID = /^[A-Za-z0-9._:-]{8,64}$/;

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const inbound = req.get("x-request-id");
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  req.startedAt = performance.now();
  res.setHeader("x-request-id", req.id);

  res.on("finish", () => {
    const durationMs = Math.round((performance.now() - req.startedAt) * 10) / 10;
    const fields = {
      requestId: req.id,
      method: req.method,
      // The path only: a query string can hold a search term or a reset token.
      path: req.path,
      status: res.statusCode,
      durationMs,
      // Present once checkAuth has run, which is what makes a line answerable
      // to "which agency saw this?".
      ...(req.user?.userId ? { userId: req.user.userId } : {}),
      ...(req.user?.agencyId ? { agencyId: req.user.agencyId } : {}),
    };

    // Health checks run every few seconds; they would drown everything else.
    if (req.path === "/health") logger.debug("request", fields);
    else if (res.statusCode >= 500) logger.error("request failed", fields);
    else if (res.statusCode >= 400) logger.warn("request rejected", fields);
    else logger.info("request", fields);
  });

  next();
};
