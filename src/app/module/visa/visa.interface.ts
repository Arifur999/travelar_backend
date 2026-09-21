import { PaymentMethod, VisaStatus } from "../../../generated/prisma/enums.js";

export interface ICreateVisaCasePayload {
  customerId: string;
  visaAgentId?: string;
  country: string;
  visaType: string;
  applicationNo?: string;
  submittedAt?: string;
  serviceFee?: number;
  embassyFee?: number;
}

export interface IUpdateVisaCasePayload {
  visaAgentId?: string;
  country?: string;
  visaType?: string;
  applicationNo?: string;
  submittedAt?: string;
  serviceFee?: number;
  embassyFee?: number;
}

export interface IChangeVisaStatusPayload {
  status: VisaStatus;
  note?: string;
}

export interface IRecordVisaPaymentPayload {
  /** Required unless the payment is settled from the wallet. */
  cashAccountId?: string;
  /** Settle from what the customer has already paid in. */
  fromWallet?: boolean;
  amount: number;
  method?: PaymentMethod;
  reference?: string;
  note?: string;
  paidAt?: string;
}
