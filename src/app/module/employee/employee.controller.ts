import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { EmployeeService } from "./employee.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

const createEmployee = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.createEmployee(requireAgencyId(req), req.body, req.user);
  ok(res, "Employee created successfully", result, status.CREATED);
});

const getAllEmployees = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.getAllEmployees(
    requireAgencyId(req),
    req.query as IqueryParams,
  );
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Employees fetched successfully",
    data: { employees: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getEmployeeDashboard = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.getEmployeeDashboard(requireAgencyId(req));
  ok(res, "Employee dashboard fetched successfully", result);
});

const getEmployeeById = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.getEmployeeById(requireAgencyId(req), req.params.id as string);
  ok(res, "Employee fetched successfully", result);
});

const updateEmployee = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.updateEmployee(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );
  ok(res, "Employee updated successfully", result);
});

const deleteEmployee = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.deleteEmployee(requireAgencyId(req), req.params.id as string);
  ok(res, result.message, null);
});

const createTransaction = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.createTransaction(requireAgencyId(req), req.body, req.user);
  ok(res, "Payout recorded successfully", result, status.CREATED);
});

const getAllTransactions = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.getAllTransactions(
    requireAgencyId(req),
    req.query as IqueryParams,
  );
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Payouts fetched successfully",
    data: { transactions: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const deleteTransaction = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.deleteTransaction(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, result.message, null);
});

const createAttendance = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.createAttendance(requireAgencyId(req), req.body, req.user);
  ok(res, "Attendance recorded successfully", result, status.CREATED);
});

const getAllAttendance = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.getAllAttendance(
    requireAgencyId(req),
    req.query as IqueryParams,
  );
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Attendance fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getAttendanceSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.getAttendanceSummary(
    requireAgencyId(req),
    req.query.employeeId as string | undefined,
  );
  ok(res, "Attendance summary fetched successfully", result);
});

const deleteAttendance = catchAsync(async (req: Request, res: Response) => {
  const result = await EmployeeService.deleteAttendance(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, result.message, null);
});

export const EmployeeController = {
  createEmployee,
  getAllEmployees,
  getEmployeeDashboard,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
  createTransaction,
  getAllTransactions,
  deleteTransaction,
  createAttendance,
  getAllAttendance,
  getAttendanceSummary,
  deleteAttendance,
};
