export interface ICreateSupplierPayload {
  name: string;
  contactName?: string;
  phone?: string;
  address?: string;
  openingPayable?: number;
}

export interface IUpdateSupplierPayload {
  name?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  openingPayable?: number;
}

export interface ISupplierLedgerTotals {
  openingPayable: number;
  totalPurchase: number;
  totalPaid: number;
  currentPayable: number;
}
