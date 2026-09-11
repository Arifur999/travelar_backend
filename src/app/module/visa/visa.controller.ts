import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { VisaAgentService } from "./visaAgent.service.js";
import { VisaService } from "./visa.service.js";

/* ------------------------------ visa cases ------------------------------ */

const createVisaCase = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.createVisaCase(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Visa case created successfully",
    data: result,
  });
});

const getAllVisaCases = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.getAllVisaCases(requireAgencyId(req), req.query as IqueryParams);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Visa cases fetched successfully",
    data: { cases: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getVisaCaseById = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.getVisaCaseById(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Visa case fetched successfully",
    data: result,
  });
});

const updateVisaCase = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.updateVisaCase(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Visa case updated successfully",
    data: result,
  });
});

const changeVisaStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.changeVisaStatus(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Visa status updated successfully",
    data: result,
  });
});

const deleteVisaCase = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.deleteVisaCase(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

/* ------------------------------ documents ------------------------------ */

const addDocument = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.addDocument(
    requireAgencyId(req),
    req.params.id as string,
    req.body.title,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Checklist item added successfully",
    data: result,
  });
});

const setDocumentStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.setDocumentStatus(
    requireAgencyId(req),
    req.params.id as string,
    req.params.documentId as string,
    req.body.status,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Checklist item updated successfully",
    data: result,
  });
});

const deleteDocument = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.deleteDocument(
    requireAgencyId(req),
    req.params.id as string,
    req.params.documentId as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Checklist item deleted successfully",
    data: result,
  });
});

/* ------------------------------- payments ------------------------------- */

const recordPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.recordPayment(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Payment recorded successfully",
    data: result,
  });
});

const deletePayment = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaService.deletePayment(
    requireAgencyId(req),
    req.params.id as string,
    req.params.paymentId as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Payment deleted successfully",
    data: result,
  });
});

/* ------------------------------- agents -------------------------------- */

const createVisaAgent = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaAgentService.createVisaAgent(requireAgencyId(req), req.body);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Visa agent created successfully",
    data: result,
  });
});

const getAllVisaAgents = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaAgentService.getAllVisaAgents(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Visa agents fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const updateVisaAgent = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaAgentService.updateVisaAgent(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Visa agent updated successfully",
    data: result,
  });
});

const deleteVisaAgent = catchAsync(async (req: Request, res: Response) => {
  const result = await VisaAgentService.deleteVisaAgent(
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

export const VisaController = {
  createVisaCase,
  getAllVisaCases,
  getVisaCaseById,
  updateVisaCase,
  changeVisaStatus,
  deleteVisaCase,
  addDocument,
  setDocumentStatus,
  deleteDocument,
  recordPayment,
  deletePayment,
  createVisaAgent,
  getAllVisaAgents,
  updateVisaAgent,
  deleteVisaAgent,
};
