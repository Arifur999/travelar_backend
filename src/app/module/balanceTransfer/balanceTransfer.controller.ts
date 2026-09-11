import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { BalanceTransferService } from "./balanceTransfer.service.js";

const createBalanceTransfer = catchAsync(async (req: Request, res: Response) => {
  const result = await BalanceTransferService.createBalanceTransfer(
    requireAgencyId(req),
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Balance transferred successfully",
    data: result,
  });
});

const getAllBalanceTransfers = catchAsync(async (req: Request, res: Response) => {
  const result = await BalanceTransferService.getAllBalanceTransfers(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Balance transfers fetched successfully",
    data: { transfers: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getBalanceTransferById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await BalanceTransferService.getBalanceTransferById(
    requireAgencyId(req),
    id as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Balance transfer fetched successfully",
    data: result,
  });
});

const updateBalanceTransfer = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await BalanceTransferService.updateBalanceTransfer(
    requireAgencyId(req),
    id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Balance transfer updated successfully",
    data: result,
  });
});

const deleteBalanceTransfer = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await BalanceTransferService.deleteBalanceTransfer(
    requireAgencyId(req),
    id as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const BalanceTransferController = {
  createBalanceTransfer,
  getAllBalanceTransfers,
  getBalanceTransferById,
  updateBalanceTransfer,
  deleteBalanceTransfer,
};
