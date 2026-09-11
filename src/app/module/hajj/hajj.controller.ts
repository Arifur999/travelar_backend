import { Request, Response } from "express";
import status from "http-status";
import { IqueryParams } from "../../interfaces/query.interface.js";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { HajjBookingService } from "./hajjBooking.service.js";
import { HajjPackageBatchRoomService } from "./hajj.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

/* ------------------------------- packages ------------------------------- */

const createPackage = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.createPackage(
    requireAgencyId(req),
    req.body,
    req.user,
  );
  ok(res, "Package created successfully", result, status.CREATED);
});

const getAllPackages = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.getAllPackages(
    requireAgencyId(req),
    req.query as IqueryParams,
  );
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Packages fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const updatePackage = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.updatePackage(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );
  ok(res, "Package updated successfully", result);
});

const deletePackage = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.deletePackage(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, result.message, null);
});

/* -------------------------------- batches ------------------------------- */

const createBatch = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.createBatch(
    requireAgencyId(req),
    req.body,
    req.user,
  );
  ok(res, "Batch created successfully", result, status.CREATED);
});

const getAllBatches = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.getAllBatches(
    requireAgencyId(req),
    req.query as IqueryParams,
  );
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Batches fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getBatchSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.getBatchSummary(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, "Batch summary fetched successfully", result);
});

const updateBatch = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.updateBatch(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );
  ok(res, "Batch updated successfully", result);
});

const deleteBatch = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.deleteBatch(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, result.message, null);
});

/* --------------------------------- rooms -------------------------------- */

const createRoom = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.createRoom(requireAgencyId(req), req.body);
  ok(res, "Room created successfully", result, status.CREATED);
});

const getRoomsByBatch = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.getRoomsByBatch(
    requireAgencyId(req),
    req.query.batchId as string,
  );
  ok(res, "Rooms fetched successfully", result);
});

const deleteRoom = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjPackageBatchRoomService.deleteRoom(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, result.message, null);
});

/* ------------------------------- bookings ------------------------------- */

const createBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.createBooking(requireAgencyId(req), req.body, req.user);
  ok(res, "Booking created successfully", result, status.CREATED);
});

const getAllBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.getAllBookings(
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
  const result = await HajjBookingService.getBookingById(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, "Booking fetched successfully", result);
});

const changeBookingStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.changeBookingStatus(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );
  ok(res, "Booking status updated successfully", result);
});

const assignRoom = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.assignRoom(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
  );
  ok(res, "Room assignment updated successfully", result);
});

const setDocumentStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.setDocumentStatus(
    requireAgencyId(req),
    req.params.id as string,
    req.params.documentId as string,
    req.body.status,
  );
  ok(res, "Checklist item updated successfully", result);
});

const recordPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.recordPayment(
    requireAgencyId(req),
    req.params.id as string,
    req.body,
    req.user,
  );
  ok(res, "Payment recorded successfully", result, status.CREATED);
});

const deletePayment = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.deletePayment(
    requireAgencyId(req),
    req.params.id as string,
    req.params.paymentId as string,
  );
  ok(res, "Payment deleted successfully", result);
});

const deleteBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await HajjBookingService.deleteBooking(
    requireAgencyId(req),
    req.params.id as string,
  );
  ok(res, result.message, null);
});

export const HajjController = {
  createPackage,
  getAllPackages,
  updatePackage,
  deletePackage,
  createBatch,
  getAllBatches,
  getBatchSummary,
  updateBatch,
  deleteBatch,
  createRoom,
  getRoomsByBatch,
  deleteRoom,
  createBooking,
  getAllBookings,
  getBookingById,
  changeBookingStatus,
  assignRoom,
  setDocumentStatus,
  recordPayment,
  deletePayment,
  deleteBooking,
};
