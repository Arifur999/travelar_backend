import { Request, Response } from "express";
import status from "http-status";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DashboardService, endOfDay } from "./dashboard.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

/** Defaults to the current calendar month when no range is given. */
const resolvePeriod = (req: Request) => {
  const now = new Date();

  const from = req.query.from
    ? new Date(req.query.from as string)
    : new Date(now.getFullYear(), now.getMonth(), 1);

  const to = req.query.to ? endOfDay(new Date(req.query.to as string)) : endOfDay(now);

  return { from, to };
};

const getSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getSummary(requireAgencyId(req));
  ok(res, "Dashboard summary fetched successfully", result);
});

/// Any date range — the spreadsheet's Custom Dashboard.
const getCustom = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getOverview(requireAgencyId(req), resolvePeriod(req));
  ok(res, "Custom dashboard fetched successfully", result);
});

const getMonthly = catchAsync(async (req: Request, res: Response) => {
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || now.getMonth() + 1;

  const from = new Date(year, month - 1, 1);
  const to = endOfDay(new Date(year, month, 0));

  const result = await DashboardService.getOverview(requireAgencyId(req), { from, to });
  ok(res, "Monthly dashboard fetched successfully", { ...result, year, month });
});

const getYearly = catchAsync(async (req: Request, res: Response) => {
  const agencyId = requireAgencyId(req);
  const year = Number(req.query.year) || new Date().getFullYear();

  const from = new Date(year, 0, 1);
  const to = endOfDay(new Date(year, 11, 31));

  const [overview, months] = await Promise.all([
    DashboardService.getOverview(agencyId, { from, to }),
    DashboardService.getMonthlyBreakdown(agencyId, year),
  ]);

  ok(res, "Yearly dashboard fetched successfully", { ...overview, year, months });
});

const getCashFlow = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.getCashFlow(requireAgencyId(req));
  ok(res, "Cash flow fetched successfully", result);
});

const upsertGoal = catchAsync(async (req: Request, res: Response) => {
  const result = await DashboardService.upsertGoal(requireAgencyId(req), req.body);
  ok(res, "Goal saved successfully", result);
});

const getGoals = catchAsync(async (req: Request, res: Response) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const result = await DashboardService.getGoalsForYear(requireAgencyId(req), year);
  ok(res, "Goals fetched successfully", result);
});

export const DashboardController = {
  getSummary,
  getCustom,
  getMonthly,
  getYearly,
  getCashFlow,
  upsertGoal,
  getGoals,
};
