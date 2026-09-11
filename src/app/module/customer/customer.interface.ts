export interface ICreateCustomerPayload {
  name: string;
  phone: string;
  email?: string;
  passportNo?: string;
  address?: string;
  note?: string;
  openingDue?: number;
}

export interface IUpdateCustomerPayload {
  name?: string;
  phone?: string;
  email?: string;
  passportNo?: string;
  address?: string;
  note?: string;
  openingDue?: number;
}

export interface ICustomerLedgerTotals {
  openingDue: number;
  totalPurchase: number;
  collectionsAmount: number;
  totalDiscount: number;
  currentDue: number;
}
