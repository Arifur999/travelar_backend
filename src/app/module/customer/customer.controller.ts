import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { CustomerService } from "./customer.service.js";

const createCustomer = catchAsync(async (req: Request, res: Response) => {
  const result = await CustomerService.createCustomer(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Customer created successfully",
    data: result,
  });
});

const getAllCustomers = catchAsync(async (req: Request, res: Response) => {
  const result = await CustomerService.getAllCustomers(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Customers fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getCustomerDashboard = catchAsync(async (req: Request, res: Response) => {
  const result = await CustomerService.getCustomerDashboard(
    requireAgencyId(req),
    req.query.sort as string | undefined,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Customer dashboard fetched successfully",
    data: result,
  });
});

const getCustomerById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CustomerService.getCustomerById(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Customer fetched successfully",
    data: result,
  });
});

const getCustomerLedger = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CustomerService.getCustomerLedger(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Customer ledger fetched successfully",
    data: result,
  });
});

const updateCustomer = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CustomerService.updateCustomer(requireAgencyId(req), id as string, req.body);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Customer updated successfully",
    data: result,
  });
});

const deleteCustomer = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CustomerService.deleteCustomer(requireAgencyId(req), id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const CustomerController = {
  createCustomer,
  getAllCustomers,
  getCustomerDashboard,
  getCustomerById,
  getCustomerLedger,
  updateCustomer,
  deleteCustomer,
};
