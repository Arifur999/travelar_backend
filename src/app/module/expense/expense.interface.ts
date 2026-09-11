export interface ICreateExpenseCategoryPayload {
  name: string;
  color?: string;
  monthlyBudget?: number;
  yearlyBudget?: number;
}

export interface IUpdateExpenseCategoryPayload {
  name?: string;
  color?: string;
  monthlyBudget?: number;
  yearlyBudget?: number;
}

export interface ICreateExpensePayload {
  categoryId: string;
  cashAccountId: string;
  amount: number;
  date?: string;
  notes?: string;
}

export interface IUpdateExpensePayload {
  categoryId?: string;
  date?: string;
  notes?: string;
}
