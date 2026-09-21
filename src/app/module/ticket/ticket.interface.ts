import { PaymentMethod, TicketStatus } from "../../../generated/prisma/enums.js";

export interface ICreateTicketPayload {
  customerId: string;
  supplierId?: string;
  airlineId?: string;
  routeId?: string;
  passengerName: string;
  pnr: string;
  travelDate?: string;
  issueDate?: string;
  fare: number;
  cost: number;
}

export type IUpdateTicketPayload = Partial<ICreateTicketPayload>;

export interface ITicketDateChangePayload {
  dateChangedAt?: string;
  travelDate?: string;
  /// What the supplier charges us for the change.
  dateChangeCost?: number;
  /// What we charge the customer for the change.
  dateChangeFee?: number;
}

export interface IChangeTicketStatusPayload {
  status: TicketStatus;
  refundAmount?: number;
  note?: string;
}

export interface IRecordTicketPaymentPayload {
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
