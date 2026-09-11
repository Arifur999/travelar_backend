import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { AirlineMasterService } from "./airlineMaster.service.js";

const createAirline = catchAsync(async (req: Request, res: Response) => {
  const result = await AirlineMasterService.createAirline(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Airline created successfully",
    data: result,
  });
});

const getAllAirlines = catchAsync(async (req: Request, res: Response) => {
  const result = await AirlineMasterService.getAllAirlines(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Airlines fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getAirlineById = catchAsync(async (req: Request, res: Response) => {
  const result = await AirlineMasterService.getAirlineById(
    requireAgencyId(req),
    req.params.id as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Airline fetched successfully",
    data: result,
  });
});

const updateAirline = catchAsync(async (req: Request, res: Response) => {
  const result = await AirlineMasterService.updateAirline(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Airline updated successfully",
    data: result,
  });
});

const deleteAirline = catchAsync(async (req: Request, res: Response) => {
  const result = await AirlineMasterService.deleteAirline(
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

export const AirlineMasterController = {
  createAirline,
  getAllAirlines,
  getAirlineById,
  updateAirline,
  deleteAirline,
};
