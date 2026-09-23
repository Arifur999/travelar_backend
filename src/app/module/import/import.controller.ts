import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ImportService } from "./import.service.js";

/**
 * Reading an uploaded workbook and reporting what is in it. Nothing is
 * written, so this is safe to run as many times as it takes to get the file
 * right.
 */
const preview = catchAsync(async (req: Request, res: Response) => {
  // Scoped like everything else: the agency is read from the session, never
  // from the request, so one agency cannot preview into another's books.
  requireAgencyId(req);

  const file = req.file;
  if (!file) {
    throw new AppError(status.BAD_REQUEST, "Attach the spreadsheet as `file`");
  }

  const result = await ImportService.preview(file.originalname, file.buffer);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Spreadsheet read successfully",
    data: result,
  });
});

export const ImportController = { preview };
