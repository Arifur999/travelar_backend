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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const globalErrorHandler = async (err: any, req: Request, res: Response, next: NextFunction) => {
  if (env.NODE_ENV === "development") {
    console.log("Error from Global Error Handler", err);
  }

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
    applySimplified(handlePrismaClientUnknownError(err), err.stack);
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    applySimplified(handlePrismaClientValidationError(err), err.stack);
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    applySimplified(handlerPrismaClientInitializationError(err), err.stack);
  } else if (err instanceof Prisma.PrismaClientRustPanicError) {
    applySimplified(handlerPrismaClientRustPanicError(), err.stack);
  } else if (err instanceof z.ZodError) {
    applySimplified(handleZodError(err), err.stack);
  } else if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
    stack = err.stack;
    errorSource = [{ path: "", message: err.message }];
  } else if (err instanceof Error) {
    statusCode = status.INTERNAL_SERVER_ERROR;
    message = err.message;
    stack = err.stack;
    errorSource = [{ path: "", message: err.message }];
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
    error: env.NODE_ENV === "development" ? err : undefined,
    stack: env.NODE_ENV === "development" ? stack : undefined,
  };

  res.status(statusCode).json(errorResponse);
};
