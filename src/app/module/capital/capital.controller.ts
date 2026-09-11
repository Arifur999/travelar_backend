import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { CapitalService } from "./capital.service.js";

const createCapitalFlow = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.createCapitalFlow(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Capital entry recorded successfully",
    data: result,
  });
});

const getAllCapitalFlows = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.getAllCapitalFlows(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Capital entries fetched successfully",
    data: { entries: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getCapitalSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.getCapitalSummary(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Investment summary fetched successfully",
    data: result,
  });
});

const updateCapitalFlow = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.updateCapitalFlow(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Capital entry updated successfully",
    data: result,
  });
});

const deleteCapitalFlow = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.deleteCapitalFlow(
    requireAgencyId(req),
    req.params.id as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const createProfitWithdrawal = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.createProfitWithdrawal(
    requireAgencyId(req),
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Profit withdrawal recorded successfully",
    data: result,
  });
});

const getAllProfitWithdrawals = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.getAllProfitWithdrawals(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Profit withdrawals fetched successfully",
    data: { withdrawals: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const updateProfitWithdrawal = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.updateProfitWithdrawal(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Profit withdrawal updated successfully",
    data: result,
  });
});

const deleteProfitWithdrawal = catchAsync(async (req: Request, res: Response) => {
  const result = await CapitalService.deleteProfitWithdrawal(
    requireAgencyId(req),
    req.params.id as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const CapitalController = {
  createCapitalFlow,
  getAllCapitalFlows,
  getCapitalSummary,
  updateCapitalFlow,
  deleteCapitalFlow,
  createProfitWithdrawal,
  getAllProfitWithdrawals,
  updateProfitWithdrawal,
  deleteProfitWithdrawal,
};
