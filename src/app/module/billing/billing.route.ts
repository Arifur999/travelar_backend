import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { BillingController } from "./billing.controller.js";
import { BillingValidation } from "./billing.validation.js";

/**
 * Public gateway callbacks. Mounted separately and with no auth, because
 * SSLCommerz calls them server-to-server with no session.
 */
export const billingWebhookRouter = Router();

billingWebhookRouter.post("/sslcommerz/ipn", BillingController.handleIpn);
billingWebhookRouter.all("/sslcommerz/success", BillingController.handleSuccess);
billingWebhookRouter.all("/sslcommerz/fail", BillingController.handleFail);
billingWebhookRouter.all("/sslcommerz/cancel", BillingController.handleCancel);

const router = Router();

// Billing is never gated on a plan or an expiry — an agency that has lapsed
// must still be able to see what it owes and pay for it.
router.use(checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF));

router.get("/plans", BillingController.listAvailablePlans);
router.get("/my-subscription", BillingController.getMySubscription);
router.get("/payment-history", BillingController.getPaymentHistory);
router.get("/orders/:transactionId/status", BillingController.getOrderStatus);

router.post(
  "/checkout",
  checkAuth(Role.AGENCY_ADMIN),
  validateRequest(BillingValidation.checkoutZodSchema),
  BillingController.checkout,
);
router.post("/orders/:transactionId/retry", checkAuth(Role.AGENCY_ADMIN), BillingController.retryOrder);

// Paying by bKash: the agency sends a receipt, an operator reads it. Staff may
// see where to pay and what is outstanding; only an admin can claim a payment.
router.get("/manual-payment", BillingController.getManualPaymentInfo);
router.get("/manual-payment/pending", BillingController.getMyPendingManualPayment);
router.post(
  "/manual-payment",
  checkAuth(Role.AGENCY_ADMIN),
  validateRequest(BillingValidation.manualPaymentZodSchema),
  BillingController.submitManualPayment,
);

export const BillingRoutes = router;
