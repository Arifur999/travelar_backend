export interface IWalletHolder {
  customerId: string;
  name: string;
  phone: string;
  /** Money this customer has handed over through collections. */
  paidIn: number;
  /** How much of it invoices have consumed. */
  usedUp: number;
  balance: number;
}

export interface IWalletSummary {
  /** What the agency is holding for its customers — a liability, not income. */
  totalHeld: number;
  customersInCredit: number;
  paidIn: number;
  usedUp: number;
}

export type IWalletMovementType = "PAID_IN" | "SPENT";

export interface IWalletMovement {
  id: string;
  date: string;
  type: IWalletMovementType;
  description: string;
  amount: number;
  /** Running balance after this movement, oldest first. */
  balance: number;
}

export interface IWalletStatement {
  customer: { id: string; name: string; phone: string };
  paidIn: number;
  usedUp: number;
  balance: number;
  movements: IWalletMovement[];
}
