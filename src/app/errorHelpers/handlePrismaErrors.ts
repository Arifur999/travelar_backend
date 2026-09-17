import status from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import { IErrorResponse } from "../interfaces/error.interfaces.js";

/**
 * Prisma errors, turned into something safe to show a user.
 *
 * Nothing Prisma wrote is echoed. Its messages begin with the file and line of
 * the failing call — the old mapper's "first meaningful line" was exactly that,
 * so a bad `?sortBy=` answered with the server's absolute source path — and go
 * on to quote the query itself. The web app shows 4xx messages to users
 * verbatim, so they are written here in plain words instead. The full error
 * is still logged: globalErrorHandler logs every 5xx with its stack.
 */

const SAFE_NAME = /^[A-Za-z0-9_.]{1,64}$/;
/** Only ever repeat a name back if it is a plain identifier. */
const safeName = (name: unknown) => (typeof name === "string" && SAFE_NAME.test(name) ? name : null);

const getStatusCodeFromPrismaError = (code: string): number => {
  if (code === "P2002") return status.CONFLICT;
  if (["P2025", "P2001", "P2015", "P2018"].includes(code)) return status.NOT_FOUND;
  if (["P1008", "P2024", "P2037"].includes(code)) return status.SERVICE_UNAVAILABLE;
  if (code.startsWith("P1")) return status.SERVICE_UNAVAILABLE;
  if (code.startsWith("P2")) return status.BAD_REQUEST;
  return status.INTERNAL_SERVER_ERROR;
};

const KNOWN_MESSAGES: Record<string, string> = {
  P2000: "A value is longer than this field allows.",
  P2001: "The record was not found.",
  P2003: "This record is still linked to other records.",
  P2011: "A required value is missing.",
  P2014: "This change would break a link to other records.",
  P2015: "A related record was not found.",
  P2018: "A related record was not found.",
  P2025: "The record was not found.",
};

const genericMessage = (statusCode: number) => {
  if (statusCode === status.SERVICE_UNAVAILABLE) return "The database is busy or unavailable. Please try again.";
  if (statusCode >= 500) return "A database error occurred.";
  return "The request could not be processed.";
};

export const handlePrismaClientKnownRequestError = (
  error: Prisma.PrismaClientKnownRequestError,
): IErrorResponse => {
  const statusCode = getStatusCodeFromPrismaError(error.code);

  let message = KNOWN_MESSAGES[error.code] ?? genericMessage(statusCode);
  if (error.code === "P2002") {
    // Services check their own uniqueness and say which rule was broken; this
    // is the fallback for a race or a rule nobody checked first.
    const target = error.meta?.target;
    const fields = (Array.isArray(target) ? target : [target]).map(safeName).filter(Boolean);
    message = fields.length
      ? `A record with the same ${fields.join(", ")} already exists.`
      : "A record with these details already exists.";
  }

  return {
    success: false,
    statusCode,
    message,
    errorSource: [{ path: error.code, message }],
  };
};

export const handlePrismaClientUnknownError = (): IErrorResponse => {
  const message = genericMessage(status.INTERNAL_SERVER_ERROR);
  return {
    success: false,
    statusCode: status.INTERNAL_SERVER_ERROR,
    message,
    errorSource: [{ path: "database", message }],
  };
};

/**
 * A query Prisma refused to build. From a client, that means a list parameter
 * named something the model does not have — `?sortBy=`, `?fields=`, a filter.
 * The offending name is the useful part, and the only part repeated.
 */
export const handlePrismaClientValidationError = (
  error: Prisma.PrismaClientValidationError,
): IErrorResponse => {
  const text = error.message;
  const unknown = safeName(text.match(/Unknown (?:argument|field|arg) `([^`]+)`/i)?.[1]);
  const missing = safeName(text.match(/Argument `([^`]+)` is missing/i)?.[1]);
  const invalid = safeName(text.match(/Invalid value for argument `([^`]+)`/i)?.[1]);

  let message = "The request could not be processed.";
  let path = "request";
  if (unknown) {
    message = `Unknown field "${unknown}".`;
    path = unknown;
  } else if (missing) {
    message = `Missing required field "${missing}".`;
    path = missing;
  } else if (invalid) {
    message = `Invalid value for "${invalid}".`;
    path = invalid;
  }

  return {
    success: false,
    statusCode: status.BAD_REQUEST,
    message,
    errorSource: [{ path, message }],
  };
};

export const handlerPrismaClientInitializationError = (): IErrorResponse => {
  const message = genericMessage(status.SERVICE_UNAVAILABLE);
  return {
    success: false,
    statusCode: status.SERVICE_UNAVAILABLE,
    message,
    errorSource: [{ path: "database", message }],
  };
};

export const handlerPrismaClientRustPanicError = (): IErrorResponse => {
  const message = genericMessage(status.INTERNAL_SERVER_ERROR);
  return {
    success: false,
    statusCode: status.INTERNAL_SERVER_ERROR,
    message,
    errorSource: [{ path: "database", message }],
  };
};
