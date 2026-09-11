import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { RouteMasterService } from "./routeMaster.service.js";

const createRoute = catchAsync(async (req: Request, res: Response) => {
  const result = await RouteMasterService.createRoute(requireAgencyId(req), req.body, req.user);

  sendResponse(res, {
    httpStatus: status.CREATED,
    success: true,
    message: "Route created successfully",
    data: result,
  });
});

const getAllRoutes = catchAsync(async (req: Request, res: Response) => {
  const result = await RouteMasterService.getAllRoutes(
    requireAgencyId(req),
    req.query as IqueryParams,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Routes fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getRouteById = catchAsync(async (req: Request, res: Response) => {
  const result = await RouteMasterService.getRouteById(
    requireAgencyId(req),
    req.params.id as string,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Route fetched successfully",
    data: result,
  });
});

const updateRoute = catchAsync(async (req: Request, res: Response) => {
  const result = await RouteMasterService.updateRoute(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Route updated successfully",
    data: result,
  });
});

const deleteRoute = catchAsync(async (req: Request, res: Response) => {
  const result = await RouteMasterService.deleteRoute(
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

export const RouteMasterController = {
  createRoute,
  getAllRoutes,
  getRouteById,
  updateRoute,
  deleteRoute,
};
