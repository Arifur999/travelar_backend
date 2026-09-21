import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { TourBookingService } from "./tourBooking.service.js";
import { TourService } from "./tour.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

/* --------------------------------- tours --------------------------------- */

const createPackage = catchAsync(async (req: Request, res: Response) => {
  const result = await TourService.createPackage(requireAgencyId(req), req.body, req.user);
  ok(res, "Tour created successfully", result, status.CREATED);
});

const getAllPackages = catchAsync(async (req: Request, res: Response) => {
  const result = await TourService.getAllPackages(
    requireAgencyId(req),
    req.query as IqueryParams,
  );
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Tours fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getPackageById = catchAsync(async (req: Request, res: Response) => {
  const result = await TourService.getPackageById(requireAgencyId(req), req.params.id as string);
  ok(res, "Tour fetched successfully", result);
});

const updatePackage = catchAsync(async (req: Request, res: Response) => {
  const result = await TourService.updatePackage(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );
  ok(res, "Tour updated successfully", result);
});

const deletePackage = catchAsync(async (req: Request, res: Response) => {
  const result = await TourService.deletePackage(requireAgencyId(req), req.params.id as string);
  ok(res, result.message, null);
});

const getSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await TourService.getSummary(requireAgencyId(req));
  ok(res, "Tour summary fetched successfully", result);
});

/* ------------------------------- bookings -------------------------------- */

const createBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.createBooking(
    requireAgencyId(req),
    req.body,
    req.user,
  );
  ok(res, "Booking created successfully", result, status.CREATED);
});

const getAllBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.getAllBookings(
    requireAgencyId(req),
    req.query as IqueryParams,
  );
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Bookings fetched successfully",
    data: { bookings: result.data, summary: result.summary },
    meta: result.meta,
  });
});

const getBookingById = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.getBookingById(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, "Booking fetched successfully", result);
});

const updateBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.updateBooking(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );
  ok(res, "Booking updated successfully", result);
});

const changeBookingStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.changeBookingStatus(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );
  ok(res, "Booking status updated successfully", result);
});

const recordPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.recordPayment(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );
  ok(res, "Payment recorded successfully", result, status.CREATED);
});

const deletePayment = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.deletePayment(
    requireAgencyId(req),
    req.params.id as string,
    req.params.paymentId as string,
  );
  ok(res, "Payment reversed successfully", result);
});

const deleteBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await TourBookingService.deleteBooking(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, result.message, null);
});

export const TourController = {
  createPackage,
  getAllPackages,
  getPackageById,
  updatePackage,
  deletePackage,
  getSummary,
  createBooking,
  getAllBookings,
  getBookingById,
  updateBooking,
  changeBookingStatus,
  recordPayment,
  deletePayment,
  deleteBooking,
};
