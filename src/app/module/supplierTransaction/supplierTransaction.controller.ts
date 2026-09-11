import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { SupplierTransactionService } from "./supplierTransaction.service.js";

const createSupplierTransaction = catchAsync(async (req: Request, res: Response) => {
  const result = await SupplierTransactionService.createSupplierTransaction(
    requireAgencyId(req),
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Supplier payment recorded successfully",
    data: result,
  });
});

const getAllSupplierTransactions = catchAsync(async (req: Request, res: Response) => {
  const result = await SupplierTransactionService.getAllSupplierTransactions(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Supplier payments fetched successfully",
    data: { transactions: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getSupplierTransactionById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SupplierTransactionService.getSupplierTransactionById(
    requireAgencyId(req),
    id as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Supplier payment fetched successfully",
    data: result,
  });
});

const updateSupplierTransaction = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SupplierTransactionService.updateSupplierTransaction(
    requireAgencyId(req),
    id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Supplier payment updated successfully",
    data: result,
  });
});

const deleteSupplierTransaction = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SupplierTransactionService.deleteSupplierTransaction(
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

export const SupplierTransactionController = {
  createSupplierTransaction,
  getAllSupplierTransactions,
  getSupplierTransactionById,
  updateSupplierTransaction,
  deleteSupplierTransaction,
};
