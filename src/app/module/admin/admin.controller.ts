import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AdminService } from "./admin.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

/* --------------------------------- plans -------------------------------- */

const createPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createPlan(req.body, req.user);
  ok(res, "Plan created successfully", result, status.CREATED);
});

const listPlans = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.listPlans();
  ok(res, "Plans fetched successfully", result);
});

const updatePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.updatePlan(req.params.id as string, req.body, req.user);
  ok(res, "Plan updated successfully", result);
});

const deactivatePlan = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.deactivatePlan(req.params.id as string, req.user);
  ok(res, result.message, null);
});

/* ------------------------------- agencies ------------------------------- */

const listAgencies = catchAsync(async (req: Request, res: Response) => {
  await AdminService.syncExpiredAgencies();
  const result = await AdminService.listAgencies(req.query as IqueryParams);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Agencies fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getAgencyById = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.getAgencyById(req.params.id as string);
  ok(res, "Agency fetched successfully", result);
});

const updateAgencyStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.updateAgencyStatus(
    req.params.id as string,
    req.body.status,
    req.user,
  );
  ok(res, result.message, null);
});

const assignPlan = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.assignPlan(req.params.id as string, req.body.planId, req.user);
  ok(res, result.message, null);
});

const extendTrial = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.extendTrial(req.params.id as string, req.body.days, req.user);
  ok(res, result.message, null);
});

const deleteAgency = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.deleteAgency(req.params.id as string, req.user);
  ok(res, result.message, null);
});

/* --------------------------- stats and audit ---------------------------- */

const getPlatformStats = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.getPlatformStats();
  ok(res, "Platform stats fetched successfully", result);
});

const listActivityLog = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.listActivityLog(req.query as IqueryParams);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Activity log fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const AdminController = {
  createPlan,
  listPlans,
  updatePlan,
  deactivatePlan,
  listAgencies,
  getAgencyById,
  updateAgencyStatus,
  assignPlan,
  extendTrial,
  deleteAgency,
  getPlatformStats,
  listActivityLog,
};
