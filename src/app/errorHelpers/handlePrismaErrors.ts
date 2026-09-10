import status from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import { IError, IErrorResponse } from "../interfaces/error.interfaces.js";

const getStatusCodeFromPrismaError = (code: string): number => {
  if (code === "P2002") return status.CONFLICT;
  if (["P2025", "P2001", "P2015", "P2018"].includes(code)) return status.NOT_FOUND;
  if (["P1000", "P6002"].includes(code)) return status.UNAUTHORIZED;
  if (["P1010", "P6010"].includes(code)) return status.FORBIDDEN;
  if (code === "P6003") return status.PAYMENT_REQUIRED;
  if (["P1008", "P2004", "P6004"].includes(code)) return status.GATEWAY_TIMEOUT;
  if (code === "P5011") return status.TOO_MANY_REQUESTS;
  if (code === "P6009") return status.REQUEST_ENTITY_TOO_LARGE;
  if (code.startsWith("P1") || ["P2024", "P2037", "P6008"].includes(code)) {
    return status.SERVICE_UNAVAILABLE;
  }
  if (code.startsWith("P2")) return status.BAD_REQUEST;
  if (code.startsWith("P3") || code.startsWith("P4")) return status.INTERNAL_SERVER_ERROR;
  return status.INTERNAL_SERVER_ERROR;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const formatErrorMeta = (meta?: Record<string, any>): string[] => {
  if (!meta) return [];

  const parts: string[] = [];
  if (meta.target) parts.push(`Field(s): ${Array.isArray(meta.target) ? meta.target.join(", ") : meta.target}`);
  if (meta.field_name) parts.push(`Field: ${meta.field_name}`);
  if (meta.column_name) parts.push(`Column: ${meta.column_name}`);
  if (meta.table) parts.push(`Table: ${meta.table}`);
  if (meta.model_name) parts.push(`Model: ${meta.model_name}`);
  if (meta.relation_name) parts.push(`Relation: ${meta.relation_name}`);
  if (meta.constraint) parts.push(`Constraint: ${meta.constraint}`);
  if (meta.database_error) parts.push(`Database: ${meta.database_error}`);

  return parts;
};

// Prisma's raw message embeds the whole failing query, which leaks schema
// detail to the client. Keep only the first meaningful line.
const cleanPrismaMessage = (message: string): string => {
  const cleaned = message.replace(/Invalid `.*?` invocation:?\s*/i, "");
  const lines = cleaned.split("\n").filter((line) => line.trim());
  return lines[0] || "An error occurred with the database operation.";
};

export const handlePrismaClientKnownRequestError = (
  error: Prisma.PrismaClientKnownRequestError,
): IErrorResponse => {
  const statusCode = getStatusCodeFromPrismaError(error.code);
  const mainMessage = cleanPrismaMessage(error.message);
  const metaParts = formatErrorMeta(error.meta);

  const errorSource: IError[] = [
    { path: error.code, message: metaParts.length ? metaParts.join(" |") : mainMessage },
  ];

  if (error.meta?.cause) {
    errorSource.push({ path: "cause", message: String(error.meta.cause) });
  }

  return {
    success: false,
    statusCode,
    message: `Prisma Client Known Request Error: ${mainMessage}`,
    errorSource,
  };
};

export const handlePrismaClientUnknownError = (
  error: Prisma.PrismaClientUnknownRequestError,
): IErrorResponse => ({
  success: false,
  statusCode: status.INTERNAL_SERVER_ERROR,
  message: `Prisma Client Unknown Request Error: ${cleanPrismaMessage(error.message)}`,
  errorSource: [{ path: "unknown", message: cleanPrismaMessage(error.message) }],
});

export const handlePrismaClientValidationError = (
  error: Prisma.PrismaClientValidationError,
): IErrorResponse => {
  const cleaned = error.message.replace(/Invalid `.*?` invocation:?\s*/i, "");
  const lines = cleaned.split("\n").filter((line) => line.trim());

  const argumentMatch = cleaned.match(/Argument `(\w+)`/i);
  const mainMessage =
    lines.find((line) => !line.includes("Argument") && !line.includes("→") && line.length > 10) ||
    "Invalid data provided.";

  return {
    success: false,
    statusCode: status.BAD_REQUEST,
    message: `Prisma Client Validation Error: ${mainMessage.trim()}`,
    errorSource: [{ path: argumentMatch?.[1] ?? "validation", message: mainMessage.trim() }],
  };
};

export const handlerPrismaClientInitializationError = (
  error: Prisma.PrismaClientInitializationError,
): IErrorResponse => ({
  success: false,
  statusCode: status.SERVICE_UNAVAILABLE,
  message: `Prisma Client Initialization Error: ${cleanPrismaMessage(error.message)}`,
  errorSource: [{ path: error.errorCode ?? "initialization", message: cleanPrismaMessage(error.message) }],
});

export const handlerPrismaClientRustPanicError = (): IErrorResponse => ({
  success: false,
  statusCode: status.INTERNAL_SERVER_ERROR,
  message: "Prisma Client Rust Panic Error: the query engine crashed. Please retry.",
  errorSource: [{ path: "engine", message: "The Prisma query engine panicked." }],
});
