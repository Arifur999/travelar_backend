import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { DueReceivedService } from "./dueReceived.service.js";

const createDueReceived = catchAsync(async (req: Request, res: Response) => {
  const result = await DueReceivedService.createDueReceived(
    requireAgencyId(req),
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Payment received successfully",
    data: result,
  });
});

const getAllDueReceived = catchAsync(async (req: Request, res: Response) => {
  const result = await DueReceivedService.getAllDueReceived(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Receipts fetched successfully",
    data: { receipts: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getDueReceivedById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await DueReceivedService.getDueReceivedById(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Receipt fetched successfully",
    data: result,
  });
});

const updateDueReceived = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await DueReceivedService.updateDueReceived(
    requireAgencyId(req),
    id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Receipt updated successfully",
    data: result,
  });
});

const deleteDueReceived = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await DueReceivedService.deleteDueReceived(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const DueReceivedController = {
  createDueReceived,
  getAllDueReceived,
  getDueReceivedById,
  updateDueReceived,
  deleteDueReceived,
};
