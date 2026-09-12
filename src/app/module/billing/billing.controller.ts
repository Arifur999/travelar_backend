import { Request, Response } from "express";
import status from "http-status";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { sendResponse } from "../../shared/sendResponse.js";
import { clientResultUrl } from "../../utils/sslcommerz.js";
import { BillingService } from "./billing.service.js";

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
};
