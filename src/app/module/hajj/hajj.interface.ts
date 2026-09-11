import {
  HajjBookingStatus,
  HajjHotelType,
  HajjMealPlan,
  HajjPackageType,
  HajjTier,
  PaymentMethod,
} from "../../../generated/prisma/enums.js";

export interface ICreateHajjPackagePayload {
  name: string;
  type: HajjPackageType;
  tier?: HajjTier;
  price: number;
  durationDays?: number;
  makkahHotel?: string;
  makkahDistance?: string;
  madinahHotel?: string;
  madinahDistance?: string;
  muallim?: string;
  mealPlan?: HajjMealPlan;
  description?: string;
  isActive?: boolean;
}

export interface ICreateHajjBatchPayload {
  packageId: string;
  name: string;
  departureDate: string;
  returnDate?: string;
  seatCapacity: number;
}

export interface ICreateHajjRoomPayload {
  batchId: string;
  hotelType: HajjHotelType;
  roomNumber: string;
  capacity: number;
}

export interface ICreateHajjBookingPayload {
  customerId: string;
  packageId: string;
  batchId: string;
  pilgrimName: string;
  passportNumber?: string;
  munajjimNumber?: string;
  /// Defaults to the package price, snapshotted at booking time.
  packagePrice?: number;
}

export interface IChangeBookingStatusPayload {
  status: HajjBookingStatus;
  note?: string;
}

export interface IAssignRoomPayload {
  hotelType: HajjHotelType;
  /// Null clears the assignment.
  roomId?: string | null;
}

export interface IRecordHajjPaymentPayload {
  cashAccountId: string;
  amount: number;
  method?: PaymentMethod;
  transactionRef?: string;
  note?: string;
  paidAt?: string;
}
