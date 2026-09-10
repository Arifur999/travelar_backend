import { CookieOptions, Request, Response } from "express";

const setCookie = (res: Response, name: string, value: string, options: CookieOptions) => {
  res.cookie(name, value, options);
};

const getCookie = (req: Request, name: string): string | undefined => req.cookies?.[name];

const clearCookie = (res: Response, name: string) => {
  res.clearCookie(name, { path: "/" });
};

export const cookieUtils = { setCookie, getCookie, clearCookie };
