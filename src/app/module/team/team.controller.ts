import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TeamService } from "./team.service.js";

const createMember = catchAsync(async (req: Request, res: Response) => {
  const result = await TeamService.createMember(requireAgencyId(req), req.user, req.body);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Team member added",
    data: result,
  });
});

const getAllMembers = catchAsync(async (req: Request, res: Response) => {
  const result = await TeamService.getAllMembers(requireAgencyId(req), req.query as IqueryParams);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Team fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getMemberById = catchAsync(async (req: Request, res: Response) => {
  const result = await TeamService.getMemberById(requireAgencyId(req), req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Team member fetched successfully",
    data: result,
  });
});

const updateMember = catchAsync(async (req: Request, res: Response) => {
  const result = await TeamService.updateMember(
    requireAgencyId(req),
    req.user,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Team member updated",
    data: result,
  });
});

const updateMemberStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await TeamService.updateMemberStatus(
    requireAgencyId(req),
    req.user,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.status === "BLOCKED" ? "Team member blocked" : "Team member reactivated",
    data: result,
  });
});

const resetMemberPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await TeamService.resetMemberPassword(
    requireAgencyId(req),
    req.user,
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

const removeMember = catchAsync(async (req: Request, res: Response) => {
  const result = await TeamService.removeMember(requireAgencyId(req), req.user, req.params.id as string);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.message,
    data: null,
  });
});

export const TeamController = {
  createMember,
  getAllMembers,
  getMemberById,
  updateMember,
  updateMemberStatus,
  resetMemberPassword,
  removeMember,
};
