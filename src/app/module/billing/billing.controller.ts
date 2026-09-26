import { Request, Response } from "express";
import status from "http-status";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import AppError from "../../errorHelpers/AppError.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { clientResultUrl } from "../../utils/sslcommerz.js";
import { BillingService } from "./billing.service.js";
import { ManualPaymentService } from "./manualPayment.service.js";
import { PaymentSettingsService } from "./paymentSettings.service.js";

const ok = (res: Response, message: string, data: unknown, httpStatus: number = status.OK) =>
  sendResponse(res, { httpStatus, success: true, message, data });

const listAvailablePlans = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.listAvailablePlans(requireAgencyId(req));
  ok(res, "Plans fetched successfully", result);
});

const getMySubscription = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.getMySubscription(requireAgencyId(req));
  ok(res, "Subscription fetched successfully", result);
});

const checkout = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.startCheckout(requireAgencyId(req), req.body.planId, req.user);
  ok(res, "Checkout session created successfully", result, status.CREATED);
});

const retryOrder = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.retryOrder(
    requireAgencyId(req),
    req.params.transactionId as string,
    req.user,
  );
  ok(res, "New checkout session created successfully", result, status.CREATED);
});

const getOrderStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.getOrderStatus(
    requireAgencyId(req),
    req.params.transactionId as string,
  );
  ok(res, "Order status fetched successfully", result);
});

const getPaymentHistory = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.getPaymentHistory(requireAgencyId(req));
  ok(res, "Payment history fetched successfully", result);
});

/**
 * The gateway's server-to-server callback. Always answers 200 — SSLCommerz
 * retries anything else, and every outcome is already recorded on the order.
 */
const handleIpn = catchAsync(async (req: Request, res: Response) => {
  const result = await BillingService.handleIpn(req.body ?? {});
  res.status(status.OK).json(result);
});

/**
 * Browser redirects. Purely for navigation — they never change an order, since
 * anyone can open these URLs. The client polls the order status instead.
 */
const redirectResult = (resultStatus: string) => (req: Request, res: Response) => {
  const transactionId = String(req.query.transactionId ?? req.body?.tran_id ?? "");
  res.redirect(302, clientResultUrl(resultStatus, transactionId));
};

/** Where to send a bKash payment, and whether it is offered at all. */
const getManualPaymentInfo = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Payment instructions fetched successfully",
    data: await ManualPaymentService.getPaymentInstructions(),
  });
});

/**
 * The QR itself.
 *
 * Sent as an image rather than embedded in the JSON above, so the browser
 * caches it like any other picture and the instructions stay a small payload.
 * Private: it is only useful to somebody who is paying, and only they are
 * signed in to ask.
 */
const getManualPaymentQr = catchAsync(async (_req: Request, res: Response) => {
  const qr = await PaymentSettingsService.getQr();

  res.setHeader("Content-Type", qr.contentType);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(qr.data);
});

/** The operator's view of the same settings, and the two ways to change them. */
const getPaymentSettings = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Payment settings fetched successfully",
    data: await PaymentSettingsService.getForOperator(),
  });
});

const updatePaymentSettings = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "bKash number saved",
    data: await PaymentSettingsService.setNumber(req.body.bkashNumber, req.user),
  });
});

const uploadPaymentQr = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError(status.BAD_REQUEST, "Attach the QR image as `file`");
  }

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "bKash QR saved",
    data: await PaymentSettingsService.setQr(req.file, req.user),
  });
});

/**
 * Records that an agency says it has paid by bKash.
 *
 * 202, not 201: what comes back is a claim waiting to be read, and the plan is
 * not on yet. The screen says so.
 */
const submitManualPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await ManualPaymentService.submit(requireAgencyId(req), req.body);

  sendResponse(res, {
    httpStatus: status.ACCEPTED,
    success: true,
    message: "Your bKash payment was received and is being checked",
    data: result,
  });
});

const getMyPendingManualPayment = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "Pending payment fetched successfully",
    data: await ManualPaymentService.getMyPending(requireAgencyId(req)),
  });
});

/** The operator's queue of bKash claims. */
const listManualPaymentsForReview = catchAsync(async (req: Request, res: Response) => {
  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: "bKash payments fetched successfully",
    data: await ManualPaymentService.listForReview({
      status: req.query.status as never,
    }),
  });
});

const reviewManualPayment = catchAsync(async (req: Request, res: Response) => {
  const result = await ManualPaymentService.review(
    req.params.id as string,
    req.body,
    req.user,
  );

  sendResponse(res, {
    httpStatus: status.OK,
    success: true,
    message: result.approved
      ? "Payment approved — the plan is now active"
      : "Payment refused",
    data: result,
  });
});

export const BillingController = {
  listAvailablePlans,
  getMySubscription,
  checkout,
  retryOrder,
  getOrderStatus,
  getPaymentHistory,
  handleIpn,
  handleSuccess: redirectResult("success"),
  handleFail: redirectResult("failed"),
  handleCancel: redirectResult("cancelled"),
  getManualPaymentInfo,
  getManualPaymentQr,
  getPaymentSettings,
  updatePaymentSettings,
  uploadPaymentQr,
  submitManualPayment,
  getMyPendingManualPayment,
  listManualPaymentsForReview,
  reviewManualPayment,
};
