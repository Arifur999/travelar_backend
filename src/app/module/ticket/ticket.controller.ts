import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TicketService } from "./ticket.service.js";

const createTicket = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.createTicket(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Ticket created successfully",
    data: result,
  });
});

const getAllTickets = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.getAllTickets(requireAgencyId(req), req.query as IqueryParams);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Tickets fetched successfully",
    data: { tickets: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getTicketById = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.getTicketById(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Ticket fetched successfully",
    data: result,
  });
});

const updateTicket = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.updateTicket(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Ticket updated successfully",
    data: result,
  });
});

const recordDateChange = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.recordDateChange(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Flight date change recorded successfully",
    data: result,
  });
});

const changeTicketStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.changeTicketStatus(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Ticket status updated successfully",
    data: result,
  });
});

const recordPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.recordPayment(
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
  const result = await TicketService.deletePayment(
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

const deleteTicket = catchAsync(async (req: Request, res: Response) => {
  const result = await TicketService.deleteTicket(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const TicketController = {
  createTicket,
  getAllTickets,
  getTicketById,
  updateTicket,
  recordDateChange,
  changeTicketStatus,
  recordPayment,
  deletePayment,
  deleteTicket,
};
