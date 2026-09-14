import crypto from "node:crypto";
import { env } from "../../config/env.js";

/**
 * SSLCommerz, spoken directly over fetch.
 *
 * `env` is read inside each call rather than captured at module scope, because
 * the config is validated at boot and this file may be imported before that.
 */
const baseUrl = () => env.SSLCOMMERZ.API_BASE;

export interface ICheckoutSessionArgs {
  transactionId: string;
  amount: number;
  productName: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
}

export interface ISslSessionResponse {
  status?: string;
  failedreason?: string;
  sessionkey?: string;
  GatewayPageURL?: string;
  [key: string]: unknown;
}

export interface ISslValidationResponse {
  status?: string;
  amount?: string | number;
  currency?: string;
  card_type?: string;
  bank_tran_id?: string;
  [key: string]: unknown;
}

/**
 * Our own reference for the order, sent to the gateway as tran_id.
 *
 * Deliberately opaque. The old format embedded the agency's id, which put a
 * tenant identifier into the gateway's records and into a URL the customer's
 * browser lands on.
 */
export const buildTransactionId = () => `ORD-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

export const createPaymentSession = async (args: ICheckoutSessionArgs): Promise<ISslSessionResponse> => {
  const appBase = env.BETTER_AUTH_URL;

  const params = new URLSearchParams({
    store_id: env.SSLCOMMERZ.STORE_ID,
    store_passwd: env.SSLCOMMERZ.STORE_PASSWORD,
    total_amount: String(args.amount),
    currency: "BDT",
    tran_id: args.transactionId,
    success_url: `${appBase}/api/v1/billing/sslcommerz/success?transactionId=${args.transactionId}`,
    fail_url: `${appBase}/api/v1/billing/sslcommerz/fail?transactionId=${args.transactionId}`,
    cancel_url: `${appBase}/api/v1/billing/sslcommerz/cancel?transactionId=${args.transactionId}`,
    ipn_url: `${appBase}/api/v1/billing/sslcommerz/ipn`,
    shipping_method: "NO",
    product_name: args.productName,
    product_category: "subscription",
    product_profile: "general",
    cus_name: args.customerName,
    cus_email: args.customerEmail,
    cus_phone: args.customerPhone || "01700000000",
    cus_add1: "N/A",
  });

  const response = await fetch(`${baseUrl()}/gwprocess/v4/api.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  return (await response.json()) as ISslSessionResponse;
};

/**
 * Confirms a payment with the gateway directly.
 *
 * The IPN body is never trusted on its own — anyone can post to that endpoint,
 * so the val_id it carries is only useful as a lookup key for this call.
 */
export const validateOrder = async (valId: string): Promise<ISslValidationResponse> => {
  const query = new URLSearchParams({
    val_id: valId,
    store_id: env.SSLCOMMERZ.STORE_ID,
    store_passwd: env.SSLCOMMERZ.STORE_PASSWORD,
    format: "json",
  });

  const response = await fetch(`${baseUrl()}/validator/api/validationserverAPI.php?${query}`);
  return (await response.json()) as ISslValidationResponse;
};

export const clientResultUrl = (status: string, transactionId: string) =>
  `${env.FRONTEND_URL}/billing/payment-result?status=${status}&tran_id=${encodeURIComponent(transactionId)}`;
