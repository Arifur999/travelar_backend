import { Request, Response } from "express";
import status from "http-status";
import { env } from "../../../config/env.js";
import { Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { auth } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { cookieUtils } from "../../utils/cookie.js";
import { jwtUtils } from "../../utils/jwt.js";
import { tokenUtils } from "../../utils/token.js";
import { AuthService } from "./auth.service.js";

/// Signs the caller in through better-auth and mints this app's own access and
/// refresh tokens on top. Both credentials are required by checkAuth: the
/// session proves a live, revocable session; the JWT carries claims the
/// frontend proxy can verify locally without a round-trip.
const issueSession = async (res: Response, email: string, password: string) => {
  const signIn = await auth.api.signInEmail({ body: { email, password } });

  const sessionToken = signIn.token;
  if (!sessionToken) {
    throw new AppError(status.UNAUTHORIZED, "Invalid email or password");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { agency: true },
  });

  if (!user) throw new AppError(status.UNAUTHORIZED, "Invalid email or password");

  const accessToken = tokenUtils.getAccessToken({
    userId: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    agencyId: user.agencyId,
  });
  const refreshToken = tokenUtils.getRefreshToken({ userId: user.id });

  tokenUtils.setAccessTokenCookie(res, accessToken);
  tokenUtils.setRefreshTokenCookie(res, refreshToken);
  tokenUtils.setBetterAuthSessionCookie(res, sessionToken);

  return { user, accessToken, refreshToken, sessionToken };
};

const register = catchAsync(async (req: Request, res: Response) => {
  const { agency } = await AuthService.registerAgency(req.body);
  const { user, accessToken, refreshToken, sessionToken } = await issueSession(
    res,
    req.body.email,
    req.body.password,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Agency registered successfully",
    data: {
      accessToken,
      refreshToken,
      token: sessionToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, agencyId: user.agencyId },
      agency: { id: agency.id, name: agency.name, status: agency.status, trialEndsAt: agency.trialEndsAt },
    },
  });
});

const login = catchAsync(async (req: Request, res: Response) => {
  // Checked before better-auth so a deactivated or deleted account gets a clear
  // reason instead of a generic credential failure.
  await AuthService.verifyCredentials(req.body);

  const { user, accessToken, refreshToken, sessionToken } = await issueSession(
    res,
    req.body.email,
    req.body.password,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Logged in successfully",
    data: {
      accessToken,
      refreshToken,
      token: sessionToken,
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, agencyId: user.agencyId,
        needPasswordChange: user.needPasswordChange,
      },
    },
  });
});

const getMe = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.getMe(req.user);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "User fetched successfully",
    data: result,
  });
});

const updateMe = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.updateMe(req.user, req.body);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Profile updated",
    data: result,
  });
});

const getMyFeatures = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.getMyFeatures(req.user);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Features fetched successfully",
    data: result,
  });
});

/// Mints a fresh access token from the refresh token. The better-auth session
/// is the authority on whether the user is still signed in — if it has been
/// revoked or expired, refreshing must fail rather than quietly resurrect access.
const getNewToken = catchAsync(async (req: Request, res: Response) => {
  const refreshToken = cookieUtils.getCookie(req, "refreshToken");
  if (!refreshToken) {
    throw new AppError(status.UNAUTHORIZED, "No refresh token provided");
  }

  const verified = jwtUtils.verifyToken(refreshToken, env.REFRESH_TOKEN_SECRET);
  if (!verified.success) {
    throw new AppError(status.UNAUTHORIZED, "Invalid or expired refresh token");
  }

  const userId = verified.decoded.userId as string;

  const session = await prisma.session.findFirst({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { expiresAt: "desc" },
    include: { user: true },
  });

  if (!session?.user || session.user.isDeleted) {
    throw new AppError(status.UNAUTHORIZED, "Session expired, please sign in again");
  }

  const user = session.user;

  const accessToken = tokenUtils.getAccessToken({
    userId: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    agencyId: user.agencyId,
  });
  const newRefreshToken = tokenUtils.getRefreshToken({ userId: user.id });

  tokenUtils.setAccessTokenCookie(res, accessToken);
  tokenUtils.setRefreshTokenCookie(res, newRefreshToken);
  tokenUtils.setBetterAuthSessionCookie(res, session.token);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Token refreshed successfully",
    data: { accessToken, refreshToken: newRefreshToken, token: session.token },
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  // Handed to better-auth as a bearer token, not as a cookie. Our cookie holds
  // the raw session token, while better-auth only reads a *signed* session
  // cookie — so forwarding it as `cookie:` found no session and every password
  // change answered 401. The bearer() plugin signs a raw token itself.
  const headers = new Headers();
  const sessionToken = cookieUtils.getCookie(req, "better-auth.session_token");
  if (sessionToken) {
    headers.set("authorization", `Bearer ${sessionToken}`);
  }

  const result = await AuthService.changePassword(req.user, req.body, headers);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  const sessionToken = cookieUtils.getCookie(req, "better-auth.session_token");
  if (sessionToken) {
    await AuthService.revokeSession(sessionToken);
  }

  tokenUtils.clearAuthCookies(res);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Logged out successfully",
    data: null,
  });
});

export const AuthController = {
  register,
  login,
  getMe,
  updateMe,
  getMyFeatures,
  getNewToken,
  changePassword,
  logout,
};

export const AUTH_ROLES_ALL = [Role.SUPER_ADMIN, Role.AGENCY_ADMIN, Role.AGENCY_STAFF] as const;
