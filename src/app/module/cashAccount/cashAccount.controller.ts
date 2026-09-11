import { Request, Response } from "express";
import status from "http-status";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { CashAccountService } from "./cashAccount.service.js";

const createCashAccount = catchAsync(async (req: Request, res: Response) => {
  const result = await CashAccountService.createCashAccount(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Cash account created successfully",
    data: result,
  });
});

const getAllCashAccounts = catchAsync(async (req: Request, res: Response) => {
  const result = await CashAccountService.getAllCashAccounts(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Cash accounts fetched successfully",
    data: result,
  });
});

const getOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await CashAccountService.getOverview(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Balance overview fetched successfully",
    data: result,
  });
});

const getCashAccountById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CashAccountService.getCashAccountById(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Cash account fetched successfully",
    data: result,
  });
});

const updateCashAccount = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CashAccountService.updateCashAccount(requireAgencyId(req), id as string, req.body);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Cash account updated successfully",
    data: result,
  });
});

const deleteCashAccount = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CashAccountService.deleteCashAccount(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const CashAccountController = {
  createCashAccount,
  getAllCashAccounts,
  getOverview,
  getCashAccountById,
  updateCashAccount,
  deleteCashAccount,
};
