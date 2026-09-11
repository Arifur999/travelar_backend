import { CashAccountCategory } from "../../../generated/prisma/enums.js";

export interface ICreateCashAccountPayload {
  name: string;
  category?: CashAccountCategory;
  openingBalance?: number;
  isActive?: boolean;
}

export interface IUpdateCashAccountPayload {
  name?: string;
  category?: CashAccountCategory;
  isActive?: boolean;
}
