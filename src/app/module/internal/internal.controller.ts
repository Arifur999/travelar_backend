import { Request, Response } from "express";
import status from "http-status";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AgencyLifecycleService } from "../agency/agencyLifecycle.service.js";

const runSubscriptionLifecycle = catchAsync(async (req: Request, res: Response) => {
  const result = await AgencyLifecycleService.runSubscriptionLifecycle();

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Subscription lifecycle ran",
    data: result,
  });
});

export const InternalController = { runSubscriptionLifecycle };
