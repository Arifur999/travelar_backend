import { Request, Response } from "express";
import status from "http-status";
import { Role } from "../../../generated/prisma/enums.js";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { SupportService } from "./support.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

/// The operator sees every agency's threads; a tenant only ever sees its own.
const scopeFor = (req: Request) =>
  req.user.role === Role.SUPER_ADMIN ? undefined : requireAgencyId(req);

const createTicket = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.createTicket(requireAgencyId(req), req.body, req.user);
  ok(res, "Ticket created successfully", result, status.CREATED);
});

const listTickets = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.listTickets(req.query as IqueryParams, scopeFor(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Tickets fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getTicketById = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.getTicketById(req.params.id as string, scopeFor(req));
  ok(res, "Ticket fetched successfully", result);
});

const addMessage = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.addMessage(
    req.params.id as string,
    req.body.message,
    req.user,
    scopeFor(req),
  );
  ok(res, "Reply sent successfully", result, status.CREATED);
});

const updateTicketStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.updateTicketStatus(req.params.id as string, req.body.status);
  ok(res, "Ticket status updated successfully", result);
});

const createAnnouncement = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.createAnnouncement(req.body, req.user);
  ok(res, "Announcement published successfully", result, status.CREATED);
});

const listAnnouncementsForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.listAnnouncementsForAdmin(req.query as IqueryParams);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Announcements fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const listMyAnnouncements = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.listAnnouncementsForUser(req.user);
  ok(res, "Announcements fetched successfully", result);
});

const markAnnouncementRead = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.markAnnouncementRead(req.params.id as string, req.user);
  ok(res, result.message, null);
});

const updateAnnouncement = catchAsync(async (req: Request, res: Response) => {
  const result = await SupportService.updateAnnouncement(req.params.id as string, req.body);
  ok(res, "Announcement updated successfully", result);
});

export const SupportController = {
  createTicket,
  listTickets,
  getTicketById,
  addMessage,
  updateTicketStatus,
  createAnnouncement,
  listAnnouncementsForAdmin,
  listMyAnnouncements,
  markAnnouncementRead,
  updateAnnouncement,
};
