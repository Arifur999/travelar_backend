import { CookieOptions, Response } from "express";
import ms, { StringValue } from "ms";
import { env } from "../../config/env.js";
import { cookieUtils } from "./cookie.js";
import { jwtUtils } from "./jwt.js";

export interface IAccessTokenPayload {
  userId: string;
  role: string;
  email: string;
  name: string;
  agencyId: string | null;
}

// sameSite "none" requires secure:true, which requires HTTPS — on plain
// http://localhost the browser silently drops the cookie, so development uses
// lax/insecure instead.
const baseCookieOptions = (maxAge: number): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
  maxAge,
});

const getAccessToken = (payload: IAccessTokenPayload) =>
  jwtUtils.createToken(payload, env.ACCESS_TOKEN_SECRET, env.ACCESS_TOKEN_EXPIRES_IN);

const getRefreshToken = (payload: { userId: string }) =>
  jwtUtils.createToken(payload, env.REFRESH_TOKEN_SECRET, env.REFRESH_TOKEN_EXPIRES_IN);

const setAccessTokenCookie = (res: Response, token: string) => {
  cookieUtils.setCookie(res, "accessToken", token,
    baseCookieOptions(ms(env.ACCESS_TOKEN_EXPIRES_IN as StringValue)));
};

const setRefreshTokenCookie = (res: Response, token: string) => {
  cookieUtils.setCookie(res, "refreshToken", token,
    baseCookieOptions(ms(env.REFRESH_TOKEN_EXPIRES_IN as StringValue)));
};

const setBetterAuthSessionCookie = (res: Response, token: string) => {
  cookieUtils.setCookie(res, "better-auth.session_token", token,
    baseCookieOptions(ms(env.ACCESS_TOKEN_EXPIRES_IN as StringValue)));
};

const clearAuthCookies = (res: Response) => {
  cookieUtils.clearCookie(res, "accessToken");
  cookieUtils.clearCookie(res, "refreshToken");
  cookieUtils.clearCookie(res, "better-auth.session_token");
};

export const tokenUtils = {
  getAccessToken,
  getRefreshToken,
  setAccessTokenCookie,
  setRefreshTokenCookie,
  setBetterAuthSessionCookie,
  clearAuthCookies,
};
