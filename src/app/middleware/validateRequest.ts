import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { z } from "zod";
import AppError from "../errorHelpers/AppError.js";

export const validateRequest = (zodSchema: z.ZodType) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Multipart requests send the JSON body as a stringified `data` field
    // alongside the binary parts, so unwrap it before parsing. Malformed JSON
    // is the caller's mistake — answer 400, don't let a SyntaxError become 500.
    if (req.body && typeof req.body.data === "string") {
      try {
        req.body = JSON.parse(req.body.data);
      } catch {
        return next(new AppError(status.BAD_REQUEST, "Expected valid JSON in the `data` field"));
      }
    }

    const parseResult = zodSchema.safeParse(req.body);

    if (!parseResult.success) {
      // Hand the ZodError to the global handler so every error in this API
      // ships the same envelope.
      return next(parseResult.error);
    }

    // Replace the body with the parsed data so schema defaults and coercions
    // reach the service.
    req.body = parseResult.data;
    next();
  };
};
