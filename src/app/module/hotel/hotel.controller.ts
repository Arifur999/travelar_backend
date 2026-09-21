import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { HotelService } from "./hotel.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

const createBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.createBooking(requireAgencyId(req), req.body, req.user);
  ok(res, "Booking created successfully", result, status.CREATED);
});

const getAllBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.getAllBookings(
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
  const result = await HotelService.getBookingById(requireAgencyId(req), req.params.id as string);
  ok(res, "Booking fetched successfully", result);
});

const updateBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.updateBooking(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );
  ok(res, "Booking updated successfully", result);
});

const changeBookingStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.changeBookingStatus(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );
  ok(res, "Booking status updated successfully", result);
});

const recordPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.recordPayment(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );
  ok(res, "Payment recorded successfully", result, status.CREATED);
});

const deletePayment = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.deletePayment(
    requireAgencyId(req),
    req.params.id as string,
    req.params.paymentId as string,
  );
  ok(res, "Payment reversed successfully", result);
});

const deleteBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.deleteBooking(requireAgencyId(req), req.params.id as string);
  ok(res, result.message, null);
});

const getSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await HotelService.getSummary(requireAgencyId(req));
  ok(res, "Hotel summary fetched successfully", result);
});

export const HotelController = {
  createBooking,
  getAllBookings,
  getBookingById,
  updateBooking,
  changeBookingStatus,
  recordPayment,
  deletePayment,
  deleteBooking,
  getSummary,
};
