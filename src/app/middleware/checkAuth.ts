import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { env } from "../../config/env.js";
import { Role, UserStatus } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";
import { prisma } from "../lib/prisma.js";
import { cookieUtils } from "../utils/cookie.js";
import { jwtUtils } from "../utils/jwt.js";

/**
 * Two credentials are required, on purpose:
 *  - the better-auth session cookie, checked against the DB so a blocked or
 *    deleted user is rejected the moment their row changes, and
 *  - the app's own accessToken JWT, whose claims the frontend proxy verifies
 *    locally without a network round-trip.
 *
 * `checkAuth()` with no arguments means "any authenticated user".
 */
export const checkAuth =
  (...authRoles: Role[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionToken = cookieUtils.getCookie(req, "better-auth.session_token");
      if (!sessionToken) {
        throw new AppError(status.UNAUTHORIZED, "Unauthorized access! No session token provided.");
      }

      const session = await prisma.session.findFirst({
        where: { token: sessionToken, expiresAt: { gt: new Date() } },
        include: { user: true },
      });

      if (!session?.user) {
        throw new AppError(status.UNAUTHORIZED, "Unauthorized access! Session not found or expired.");
      }

      const user = session.user;

      // Warn the client before the session actually dies, so a long editing
      // session doesn't expire mid-action.
      const expiresAt = new Date(session.expiresAt);
      const createdAt = new Date(session.createdAt);
      const lifetime = expiresAt.getTime() - createdAt.getTime();
      const remaining = expiresAt.getTime() - Date.now();

      if (lifetime > 0 && (remaining / lifetime) * 100 < 20) {
        res.setHeader("X-Session-Refresh", "true");
        res.setHeader("X-Session-Expires-At", expiresAt.toISOString());
        res.setHeader("X-Time-Remaining", String(remaining));
      }

      if (user.status === UserStatus.BLOCKED || user.status === UserStatus.DELETED) {
        throw new AppError(status.UNAUTHORIZED, "Unauthorized access! This account is not active.");
      }
      if (user.isDeleted) {
        throw new AppError(status.UNAUTHORIZED, "Unauthorized access! This account has been deleted.");
      }
      if (authRoles.length > 0 && !authRoles.includes(user.role)) {
        throw new AppError(status.FORBIDDEN, "Forbidden access! You do not have permission to access this resource.");
      }

      const accessToken = cookieUtils.getCookie(req, "accessToken");
      if (!accessToken) {
        throw new AppError(status.UNAUTHORIZED, "Unauthorized access! No access token provided.");
      }

      const verified = jwtUtils.verifyToken(accessToken, env.ACCESS_TOKEN_SECRET);
      if (!verified.success) {
        throw new AppError(status.UNAUTHORIZED, "Unauthorized access! Invalid access token.");
      }

      // Checked against the DB row too — the token may have been minted before
      // a role change.
      if (authRoles.length > 0 && !authRoles.includes(verified.decoded.role as Role)) {
        throw new AppError(status.FORBIDDEN, "Forbidden access! You do not have permission to access this resource.");
      }

      req.user = {
        userId: user.id,
        role: user.role,
        email: user.email,
        agencyId: user.agencyId,
      };

      next();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      next(error);
    }
  };
