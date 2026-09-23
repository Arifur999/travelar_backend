import { ImportKind } from "./import.constant.js";

/** Something about one row that the reader could not resolve. */
export interface IRowProblem {
  /** 1-based, as the spreadsheet shows it. */
  row: number;
  field: string;
  message: string;
}

export interface ITabPreview {
  tab: string;
  kind: ImportKind | null;
  title: string | null;
  /** What each row would become, in words. */
  creates: string | null;
  /** Rows that look like data, whether or not they can be imported. */
  dataRows: number;
  /** Rows that can be imported as they stand. */
  readyRows: number;
  /** Our field → the column heading it was found under. */
  mapped: Record<string, string>;
  /** Fields the sheet has no column for. */
  unmapped: string[];
  problems: IRowProblem[];
  /** A few rows as they would be read, so the numbers can be eyeballed. */
  sample: Record<string, string | number | null>[];
  /** Money columns totalled, so they can be checked against the sheet. */
  totals: Record<string, number>;
}

export interface IImportPreview {
  filename: string;
  tabs: ITabPreview[];
  /** Tabs that are reports, not data, and are skipped on purpose. */
  skipped: string[];
  /** Everything the import would create, across tabs. */
  wouldCreate: {
    customers: number;
    suppliers: number;
    airlines: number;
    accounts: number;
    expenseCategories: number;
    tickets: number;
    ticketPayments: number;
    collections: number;
    supplierPayments: number;
    expenses: number;
    capitalFlows: number;
  };
}

/** What one import run created. */
export interface IFoundationsResult {
  importId: string;
  filename: string;
  stage: "FOUNDATIONS" | "HISTORY";
  counts: Record<string, number>;
}

export interface IImportRun {
  id: string;
  filename: string;
  stage: "FOUNDATIONS" | "HISTORY";
  status: "COMPLETED" | "REVERTED";
  counts: Record<string, number>;
  revertedAt: string | null;
  createdAt: string;
}
