import { Request, Response } from "express";
import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { FoundationsImportService } from "./foundations.service.js";
import { HistoryImportService } from "./history.service.js";
import { ImportRunService } from "./importRun.service.js";
import { ImportRunnerService } from "./importRunner.service.js";
import { importMemoryProblem } from "./memoryLimit.js";
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

  // Reading the file to report on it costs the same as reading it to import
  // it, and dies the same way.
  const tooBig = importMemoryProblem(file.buffer.length);
  if (tooBig) throw new AppError(status.INSUFFICIENT_STORAGE, tooBig);

  const result = await ImportService.preview(file.originalname, file.buffer);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Spreadsheet read successfully",
    data: result,
  });
});

/** Creates the lists the history will point at. */
const importFoundations = catchAsync(async (req: Request, res: Response) => {
  const agencyId = requireAgencyId(req);

  const file = req.file;
  if (!file) {
    throw new AppError(status.BAD_REQUEST, "Attach the spreadsheet as `file`");
  }

  const result = await FoundationsImportService.importFoundations(
    agencyId,
    file.originalname,
    file.buffer,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Your lists were brought across",
    data: result,
  });
});

/**
 * Writes the trading history on top of the lists.
 *
 * The answer carries the totals it wrote alongside the counts, because the
 * first thing an owner does with imported books is check them against the
 * figures printed at the top of their own spreadsheet.
 */
const importHistory = catchAsync(async (req: Request, res: Response) => {
  const agencyId = requireAgencyId(req);

  const file = req.file;
  if (!file) {
    throw new AppError(status.BAD_REQUEST, "Attach the spreadsheet as `file`");
  }

  const result = await HistoryImportService.importHistory(
    agencyId,
    file.originalname,
    file.buffer,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Your history was brought across",
    data: result,
  });
});

/**
 * Brings the whole workbook across: the lists, then the history on top.
 *
 * Answers as soon as the run has started, not when it has finished — a year of
 * business takes minutes, and the screen follows the run by its id.
 */
const startImport = catchAsync(async (req: Request, res: Response) => {
  const agencyId = requireAgencyId(req);

  const file = req.file;
  if (!file) {
    throw new AppError(status.BAD_REQUEST, "Attach the spreadsheet as `file`");
  }

  const result = await ImportRunnerService.start(agencyId, file.originalname, file.buffer, req.user, {
    // Uploading the same workbook again is a mistake often enough that it is
    // refused by default, and has to be asked for twice.
    force: req.body?.force === "true" || req.body?.force === true,
  });

  sendResponse(res, {
    httpStatus: result.alreadyImported ? status.OK : status.ACCEPTED,
    success: true,
    message: result.alreadyImported
      ? "This spreadsheet has already been brought in"
      : "Bringing your spreadsheet in — this page will follow along",
    data: result,
  });
});

const getRun = catchAsync(async (req: Request, res: Response) => {
  const result = await ImportRunService.getRun(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Import fetched successfully",
    data: result,
  });
});

const listRuns = catchAsync(async (req: Request, res: Response) => {
  const result = await ImportRunService.listRuns(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Imports fetched successfully",
    data: result,
  });
});

const revertRun = catchAsync(async (req: Request, res: Response) => {
  const result = await ImportRunService.revertRun(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "That import was undone",
    data: result,
  });
});

export const ImportController = {
  preview,
  startImport,
  importFoundations,
  importHistory,
  getRun,
  listRuns,
  revertRun,
};
