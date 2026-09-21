import { Request, Response } from "express";
import status from "http-status";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { WalletService } from "./wallet.service.js";

const getSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletService.getSummary(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Wallet summary fetched successfully",
    data: result,
  });
});

const getHolders = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletService.getHolders(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Wallet balances fetched successfully",
    data: result,
  });
});

const getStatement = catchAsync(async (req: Request, res: Response) => {
  const result = await WalletService.getStatement(
    requireAgencyId(req),
    req.params.customerId as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Wallet statement fetched successfully",
    data: result,
  });
});

export const WalletController = {
  getSummary,
  getHolders,
  getStatement,
};
