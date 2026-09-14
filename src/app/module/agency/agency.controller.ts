import { Request, Response } from "express";
import status from "http-status";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AgencyService } from "./agency.service.js";

const getProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await AgencyService.getProfile(requireAgencyId(req));

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Agency profile fetched successfully",
    data: result,
  });
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
  const result = await AgencyService.updateProfile(requireAgencyId(req), req.body);

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Agency profile updated",
    data: result,
  });
});

export const AgencyController = { getProfile, updateProfile };
