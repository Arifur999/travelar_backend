export interface ICreateDueReceivedPayload {
  customerId: string;
  cashAccount1Id: string;
  amount1: number;
  cashAccount2Id?: string;
  amount2?: number;
  discount?: number;
  discountCategory?: string;
  date?: string;
  notes?: string;
}

export interface IUpdateDueReceivedPayload {
  date?: string;
  discount?: number;
  discountCategory?: string;
  notes?: string;
}
