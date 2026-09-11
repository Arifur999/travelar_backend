import { CapitalFlowType } from "../../../generated/prisma/enums.js";

export interface ICreateCapitalFlowPayload {
  ownerName: string;
  type: CapitalFlowType;
  amount: number;
  cashAccountId: string;
  date?: string;
  note?: string;
}

export interface ICreateProfitWithdrawalPayload {
  receivedBy: string;
  amount: number;
  cashAccountId: string;
  date?: string;
  note?: string;
}

export interface IUpdateDateNotePayload {
  date?: string;
  note?: string;
}
