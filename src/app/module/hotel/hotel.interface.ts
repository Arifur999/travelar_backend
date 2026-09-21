import { HotelBookingStatus, PaymentMethod } from "../../../generated/prisma/enums.js";

export interface ICreateHotelBookingPayload {
  customerId: string;
  hotelName: string;
  city: string;
  country?: string;
  /// Free text: who the rate came from. See hotels.prisma for why it is not a
  /// supplier relation.
  bookedThrough?: string;
  confirmationNo?: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  rooms?: number;
  guests?: number;
  roomType?: string;
  sellAmount: number;
  costAmount?: number;
  note?: string;
}

/// The customer is absent: a booking cannot change hands.
export type IUpdateHotelBookingPayload = Partial<Omit<ICreateHotelBookingPayload, "customerId">>;

export interface IChangeHotelStatusPayload {
  status: HotelBookingStatus;
  note?: string;
}

export interface IRecordHotelPaymentPayload {
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
