import {
  PaymentMethod,
  TourBookingStatus,
  TourPackageStatus,
} from "../../../generated/prisma/enums.js";

export interface ICreateTourPackagePayload {
  name: string;
  destination: string;
  departureDate?: string;
  returnDate?: string;
  durationDays?: number;
  /// Omitted means the tour has no fixed seat limit.
  seatCapacity?: number;
  pricePerPerson: number;
  costPerPerson?: number;
  inclusions?: string;
  description?: string;
  status?: TourPackageStatus;
}

export type IUpdateTourPackagePayload = Partial<ICreateTourPackagePayload>;

export interface ICreateTourBookingPayload {
  customerId: string;
  packageId: string;
  leadTraveller: string;
  travellers?: number;
  /// Both default to the package rate times the seats, snapshotted here.
  sellAmount?: number;
  costAmount?: number;
  note?: string;
}

export interface IUpdateTourBookingPayload {
  leadTraveller?: string;
  travellers?: number;
  sellAmount?: number;
  costAmount?: number;
  note?: string;
}

export interface IChangeTourStatusPayload {
  status: TourBookingStatus;
  note?: string;
}

export interface IRecordTourPaymentPayload {
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
