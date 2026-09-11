import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { ExpenseService } from "./expense.service.js";

/* ------------------------------ categories ------------------------------ */

const createCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.createCategory(requireAgencyId(req), req.body);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Expense category created successfully",
    data: result,
  });
});

const getAllCategories = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.getAllCategories(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Expense categories fetched successfully",
    data: result,
  });
});

const updateCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.updateCategory(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Expense category updated successfully",
    data: result,
  });
});

const deleteCategory = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.deleteCategory(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

/* ------------------------------- expenses ------------------------------- */

const createExpense = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.createExpense(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Expense recorded successfully",
    data: result,
  });
});

const getAllExpenses = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.getAllExpenses(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Expenses fetched successfully",
    data: { expenses: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getExpenseDashboard = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.getExpenseDashboard(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Expense dashboard fetched successfully",
    data: result,
  });
});

const getExpenseById = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.getExpenseById(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Expense fetched successfully",
    data: result,
  });
});

const updateExpense = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.updateExpense(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Expense updated successfully",
    data: result,
  });
});

const deleteExpense = catchAsync(async (req: Request, res: Response) => {
  const result = await ExpenseService.deleteExpense(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const ExpenseController = {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  createExpense,
  getAllExpenses,
  getExpenseDashboard,
  getExpenseById,
  updateExpense,
  deleteExpense,
};
