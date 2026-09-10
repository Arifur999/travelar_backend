import status from "http-status";
import { z } from "zod";
import { IErrorResponse } from "../interfaces/error.interfaces.js";

export const handleZodError = (err: z.ZodError): IErrorResponse => {
  const errorSource: IErrorResponse["errorSource"] = [];

  err.issues.forEach((issue) => {
    errorSource.push({
      // Nested paths are joined so the client can point at the exact field,
      // e.g. "customer=>phone".
      path: issue.path.length > 1 ? issue.path.join("=>") : String(issue.path[0]),
      message: issue.message,
    });
  });

  return {
    success: false,
    message: "Validation failed",
    statusCode: status.BAD_REQUEST,
    errorSource,
    error: err,
  };
};
