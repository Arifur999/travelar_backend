import { ImportKind } from "./import.constant.js";
import type { SheetData } from "./sheetReader.js";

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
  /** How many rows carry a figure in each money column, which is not the
   * row count: most sales rows have no date-change fee. */
  rowsWith: Record<string, number>;
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
    profitWithdrawals: number;
  };
}

/**
 * How far a run has got.
 *
 * Named steps rather than a bare percentage: "Air tickets, 1,240 of 3,180" is
 * something an owner can wait through, where a bar creeping along on its own
 * only raises the question of whether anything is happening at all.
 */
export interface IImportProgress {
  step: string;
  stepNumber: number;
  stepCount: number;
  done: number;
  total: number;
  /** 0–100, what the bar shows. */
  percent: number;
}

/**
 * Passed to a stage when it is one half of a longer run: the record to attach
 * its rows to, where to say how far it has got, and the workbook already read.
 *
 * The sheets matter as much as the rest. Reading one of these files is the
 * most expensive thing the import does, and the two stages were each doing it
 * — twice the peak memory for an answer that cannot have changed in between.
 */
export interface IRunContext {
  importId: string;
  report: (step: string, done: number, total: number) => void;
  sheets?: SheetData[];
}

/** One row an import created, and the line of the sheet it came from. */
export interface IImportedRecord {
  /** Which table, as the rollback knows it: "customer", "ticket", … */
  entity: string;
  entityId: string;
  sourceTab?: string;
  sourceRow?: number;
}

/** What one import run created. */
export interface IFoundationsResult {
  importId: string;
  filename: string;
  stage: "FOUNDATIONS" | "HISTORY";
  counts: Record<string, number>;
}

/** A problem, and the tab it was on — a history run reads every tab. */
export interface ITabProblem extends IRowProblem {
  tab: string;
}

/**
 * What the history run wrote, and what it could not.
 *
 * `totals` is the point of the report: the same figures the spreadsheet prints
 * at the top of its own tabs, recomputed from what was actually imported, so
 * the two can be put side by side before anyone trusts the new books.
 */
export interface IHistoryResult {
  importId: string;
  filename: string;
  stage: "HISTORY";
  counts: Record<string, number>;
  /** Rows already in the books from an earlier run, and left alone. */
  skipped: Record<string, number>;
  totals: Record<string, number>;
  problems: ITabProblem[];
}

export interface IImportRun {
  id: string;
  filename: string;
  stage: "FOUNDATIONS" | "HISTORY" | "EVERYTHING";
  status: "RUNNING" | "COMPLETED" | "FAILED" | "REVERTED";
  counts: Record<string, number>;
  progress: IImportProgress | null;
  /** The finished report, once there is one. */
  result: {
    totals?: Record<string, number>;
    skipped?: Record<string, number>;
    problems?: ITabProblem[];
  } | null;
  /** Why it failed, when it did. */
  note: string | null;
  revertedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What starting a run answers with, before any of the work is done. */
export interface IImportStarted {
  importId: string;
  /** Set when this exact file has been imported before and was not undone. */
  alreadyImported: IImportRun | null;
}
