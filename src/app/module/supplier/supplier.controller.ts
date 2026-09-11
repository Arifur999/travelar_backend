import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { SupplierService } from "./supplier.service.js";

const createSupplier = catchAsync(async (req: Request, res: Response) => {
  const result = await SupplierService.createSupplier(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Supplier created successfully",
    data: result,
  });
});

const getAllSuppliers = catchAsync(async (req: Request, res: Response) => {
  const result = await SupplierService.getAllSuppliers(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Suppliers fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getSupplierDashboard = catchAsync(async (req: Request, res: Response) => {
  const result = await SupplierService.getSupplierDashboard(
    requireAgencyId(req),
    req.query.sort as string | undefined,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Supplier dashboard fetched successfully",
    data: result,
  });
});

const getSupplierById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SupplierService.getSupplierById(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Supplier fetched successfully",
    data: result,
  });
});

const getSupplierLedger = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SupplierService.getSupplierLedger(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Supplier ledger fetched successfully",
    data: result,
  });
});

const updateSupplier = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SupplierService.updateSupplier(requireAgencyId(req), id as string, req.body);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Supplier updated successfully",
    data: result,
  });
});

const deleteSupplier = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await SupplierService.deleteSupplier(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const SupplierController = {
  createSupplier,
  getAllSuppliers,
  getSupplierDashboard,
  getSupplierById,
  getSupplierLedger,
  updateSupplier,
  deleteSupplier,
};
