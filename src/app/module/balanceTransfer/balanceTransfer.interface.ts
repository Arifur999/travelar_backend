export interface ICreateBalanceTransferPayload {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date?: string;
  note?: string;
}

export interface IUpdateBalanceTransferPayload {
  date?: string;
  note?: string;
}
