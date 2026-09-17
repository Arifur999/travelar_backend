import { APIError } from "better-auth/api";
import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { z } from "zod";
import { env } from "../../config/env.js";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "../errorHelpers/AppError.js";
import {
  handlePrismaClientKnownRequestError,
  handlePrismaClientUnknownError,
  handlePrismaClientValidationError,
  handlerPrismaClientInitializationError,
  handlerPrismaClientRustPanicError,
} from "../errorHelpers/handlePrismaErrors.js";
import { handleZodError } from "../errorHelpers/handleZodError.js";
import { IError, IErrorResponse } from "../interfaces/error.interfaces.js";
import { captureException } from "../lib/sentry.js";
import { deleteUploadedFilesFromGlobalErrorHandler } from "../utils/deleteUploadedFilesFromGlobalError.js";
import { logger } from "../lib/logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const globalErrorHandler = async (err: any, req: Request, res: Response, _next: NextFunction) => {
  await deleteUploadedFilesFromGlobalErrorHandler(req);

  let errorSource: IError[] = [];
  let statusCode: number = status.INTERNAL_SERVER_ERROR;
  let message = "Internal Server Error";
  let stack: string | undefined = undefined;

  const applySimplified = (simplified: IErrorResponse, originalStack?: string) => {
    statusCode = simplified.statusCode as number;
    message = simplified.message;
    errorSource = [...simplified.errorSource];
    stack = originalStack;
  };

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    applySimplified(handlePrismaClientKnownRequestError(err), err.stack);
  } else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    applySimplified(handlePrismaClientUnknownError(), err.stack);
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    applySimplified(handlePrismaClientValidationError(err), err.stack);
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    applySimplified(handlerPrismaClientInitializationError(), err.stack);
  } else if (err instanceof Prisma.PrismaClientRustPanicError) {
    applySimplified(handlerPrismaClientRustPanicError(), err.stack);
  } else if (err instanceof z.ZodError) {
    applySimplified(handleZodError(err), err.stack);
  } else if (err instanceof APIError) {
    // better-auth signals failures with its own error type carrying the right
    // HTTP status. Without this branch a wrong password fell through to the
    // generic Error case and answered 500 instead of 401.
    statusCode = err.statusCode ?? status.UNAUTHORIZED;
    message = err.body?.message ?? err.message;
    stack = err.stack;
    errorSource = [{ path: "", message }];
  } else if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    stack = err.stack;
    errorSource = [{ path: "", message: err.message }];
  } else if (err instanceof Error) {
    // An error nobody anticipated: its message describes our internals ("Cannot
    // read properties of undefined…"), so outside development the caller gets
    // a plain sentence and the request id, and the log gets the rest.
    statusCode = status.INTERNAL_SERVER_ERROR;
    message = env.NODE_ENV === "development" ? err.message : "Internal Server Error";
    stack = err.stack;
    errorSource = [{ path: "", message }];
  }

  // 5xx is ours to fix, so it is logged with the stack; 4xx is the caller's
  // mistake and the access log line already records it.
  if (statusCode >= status.INTERNAL_SERVER_ERROR) {
    logger.error("unhandled error", { requestId: req.id, method: req.method, path: req.path, statusCode, err });
  } else {
    logger.debug("request error", { requestId: req.id, method: req.method, path: req.path, statusCode, message });
  }

  // Report genuine server errors (5xx) to error monitoring — not expected
  // client errors like 401/403/404/validation, which would just be noise.
  if (statusCode >= status.INTERNAL_SERVER_ERROR) {
    captureException(err, { path: req.originalUrl, method: req.method, statusCode });
  }

  const errorResponse: IErrorResponse = {
    success: false,
    message,
    errorSource,
    requestId: req.id,
    error: env.NODE_ENV === "development" ? err : undefined,
    stack: env.NODE_ENV === "development" ? stack : undefined,
  };

  res.status(statusCode).json(errorResponse);
};
