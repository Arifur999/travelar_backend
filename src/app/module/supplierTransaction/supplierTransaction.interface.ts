export interface ICreateSupplierTransactionPayload {
  supplierId: string;
  cashAccountId: string;
  amount: number;
  date?: string;
  note?: string;
}

export interface IUpdateSupplierTransactionPayload {
  date?: string;
  note?: string;
}
