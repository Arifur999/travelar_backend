import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import {
  REPORT_ONLY_TABS,
  TAB_SPECS,
  type FieldSpec,
  type TabSpec,
} from "./import.constant.js";
import { IImportPreview, IRowProblem, ITabPreview } from "./import.interface.js";
import {
  columnOf,
  dateAt,
  findHeaderRow,
  hasAnyOf,
  moneyAt,
  readWorkbook,
  textAt,
  type SheetData,
  type SheetRow,
} from "./sheetReader.js";

/**
 * Reading an agency's existing spreadsheet and saying what is in it.
 *
 * This step writes nothing. An import that goes straight from a file to the
 * books is an import nobody can check, and these books are the agency's own
 * money — so the file is read, everything that would be created is counted,
 * everything that cannot be read is listed with its row number, and a person
 * decides.
 */

const normalise = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const specForTab = (name: string): TabSpec | null =>
  TAB_SPECS.find((spec) => spec.tabNames.some((candidate) => normalise(name).includes(candidate))) ??
  null;

const isReportOnly = (name: string) =>
  REPORT_ONLY_TABS.some((candidate) => normalise(name).includes(candidate));

const valueOf = (row: SheetRow, field: FieldSpec, index: number | null) => {
  switch (field.type) {
    case "money":
    case "number":
      return moneyAt(row, index);
    case "date":
      return dateAt(row, index);
    default:
      return textAt(row, index);
  }
};

/** A cell as the preview shows it: dates as a day, money as a number. */
const forDisplay = (value: string | number | Date | null) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
};

const previewTab = (sheet: SheetData): ITabPreview => {
  const spec = specForTab(sheet.name);

  if (!spec) {
    return {
      tab: sheet.name,
      kind: null,
      title: null,
      creates: null,
      dataRows: 0,
      readyRows: 0,
      mapped: {},
      unmapped: [],
      problems: [],
      sample: [],
      totals: {},
    };
  }

  const header = findHeaderRow(
    sheet.rows,
    spec.fields.map((field) => field.labels),
  );

  if (!header) {
    return {
      tab: sheet.name,
      kind: spec.kind,
      title: spec.title,
      creates: spec.creates,
      dataRows: 0,
      readyRows: 0,
      mapped: {},
      unmapped: spec.fields.map((field) => field.field),
      problems: [
        {
          row: 0,
          field: "header",
          message:
            "No heading row recognised on this tab. Its columns may have been renamed — map them by hand before importing.",
        },
      ],
      sample: [],
      totals: {},
    };
  }

  const indexes = new Map<string, number | null>();
  const mapped: Record<string, string> = {};
  const unmapped: string[] = [];

  for (const field of spec.fields) {
    const index = columnOf(header, field.labels);
    indexes.set(field.field, index);
    if (index === null) unmapped.push(field.field);
    else mapped[field.field] = String(header.cells[index] ?? "").trim();
  }

  const required = spec.fields.filter((field) => field.required);
  const identifying = required.length > 0 ? required : spec.fields;
  const identifyingIndexes = identifying.map((field) => indexes.get(field.field) ?? null);

  const problems: IRowProblem[] = [];
  const sample: Record<string, string | number | null>[] = [];
  const totals: Record<string, number> = {};
  let dataRows = 0;
  let readyRows = 0;

  for (const row of sheet.rows) {
    if (row.number <= header.number) continue;
    if (!hasAnyOf(row, identifyingIndexes)) continue;

    dataRows += 1;

    const read: Record<string, string | number | null> = {};
    let usable = true;

    for (const field of spec.fields) {
      const index = indexes.get(field.field) ?? null;
      const value = valueOf(row, field, index);

      if (field.required && (value === null || value === "")) {
        // One line per row per missing field: the point is to be able to open
        // the sheet at that row and see why.
        problems.push({
          row: row.number,
          field: field.field,
          message:
            index === null
              ? `No column found for ${field.field}`
              : `${field.field} is empty or could not be read`,
        });
        usable = false;
        continue;
      }

      if (field.type === "money" && typeof value === "number") {
        totals[field.field] = (totals[field.field] ?? 0) + value;
      }

      read[field.field] = forDisplay(value);
    }

    if (usable) readyRows += 1;
    if (sample.length < 3) sample.push(read);
  }

  return {
    tab: sheet.name,
    kind: spec.kind,
    title: spec.title,
    creates: spec.creates,
    dataRows,
    readyRows,
    mapped,
    unmapped,
    // A thousand identical problems help nobody; the count is in dataRows −
    // readyRows, and the first fifty are enough to see the pattern.
    problems: problems.slice(0, 50),
    sample,
    totals: Object.fromEntries(
      Object.entries(totals).map(([field, total]) => [field, Math.round(total * 100) / 100]),
    ),
  };
};

/** Distinct names in a column, which is how many records it would create. */
const distinctCount = (
  sheet: SheetData | undefined,
  labels: string[],
  alongside: string[],
): number => {
  if (!sheet) return 0;
  // Two groups, because a heading row has to out-score the summary block
  // above it, and one column cannot do that on its own.
  const header = findHeaderRow(sheet.rows, [labels, alongside]);
  if (!header) return 0;

  const index = columnOf(header, labels);
  if (index === null) return 0;

  const seen = new Set<string>();
  for (const row of sheet.rows) {
    if (row.number <= header.number) continue;
    const value = textAt(row, index);
    if (value) seen.add(normalise(value));
  }
  return seen.size;
};

const preview = async (filename: string, file: Buffer): Promise<IImportPreview> => {
  if (!file || file.length === 0) {
    throw new AppError(status.BAD_REQUEST, "The file is empty");
  }

  let sheets: SheetData[];
  try {
    sheets = await readWorkbook(file);
  } catch {
    throw new AppError(
      status.BAD_REQUEST,
      "This file could not be read as a spreadsheet. Export it from Google Sheets as Microsoft Excel (.xlsx) and try again.",
    );
  }

  const tabs: ITabPreview[] = [];
  const skipped: string[] = [];

  for (const sheet of sheets) {
    if (isReportOnly(sheet.name) || !specForTab(sheet.name)) {
      skipped.push(sheet.name);
      continue;
    }
    tabs.push(previewTab(sheet));
  }

  const bySpec = (kind: string) => tabs.find((tab) => tab.kind === kind);
  const sheetFor = (kind: string) => {
    const tab = bySpec(kind);
    return tab ? sheets.find((sheet) => sheet.name === tab.tab) : undefined;
  };

  const sales = sheetFor("sales");
  const collections = sheetFor("collections");
  const masterData = sheetFor("masterData");

  // Customers and suppliers are counted across the tabs that name them, not
  // per tab: the same customer appears on a sale and on a collection, and
  // importing both must not promise two records.
  const customerNames = new Set<string>();
  for (const [sheet, labels] of [
    [sales, ["phone", "full name"]],
    [collections, ["phone", "customer"]],
  ] as const) {
    if (!sheet) continue;
    const header = findHeaderRow(sheet.rows, [["phone"], [...labels]]);
    if (!header) continue;
    const phone = columnOf(header, ["phone"]);
    const name = columnOf(header, [...labels]);
    for (const row of sheet.rows) {
      if (row.number <= header.number) continue;
      const key = textAt(row, phone) ?? textAt(row, name);
      if (key) customerNames.add(normalise(key));
    }
  }

  const supplierNames = new Set<string>();
  for (const sheet of [masterData, sales, sheetFor("supplierPayments")]) {
    if (!sheet) continue;
    const header = findHeaderRow(sheet.rows, [["agency name"], ["contact name", "amount", "full name"]]);
    if (!header) continue;
    const index = columnOf(header, ["agency name"]);
    for (const row of sheet.rows) {
      if (row.number <= header.number) continue;
      const value = textAt(row, index);
      if (value) supplierNames.add(normalise(value));
    }
  }

  const salesTab = bySpec("sales");

  return {
    filename,
    tabs,
    skipped,
    wouldCreate: {
      customers: customerNames.size,
      suppliers: supplierNames.size,
      airlines: distinctCount(
        masterData,
        ["airlines name", "airlines or visa name", "airlines company name"],
        ["short code"],
      ),
      accounts: bySpec("accounts")?.dataRows ?? 0,
      expenseCategories: distinctCount(sheetFor("expenses"), ["category"], ["amount", "date"]),
      tickets: salesTab?.readyRows ?? 0,
      // A sale row carries its own payment when money was taken against it.
      ticketPayments: salesTab ? Math.round(salesTab.totals.paidAmount ? salesTab.readyRows : 0) : 0,
      collections: bySpec("collections")?.readyRows ?? 0,
      supplierPayments: bySpec("supplierPayments")?.readyRows ?? 0,
      expenses: bySpec("expenses")?.readyRows ?? 0,
      capitalFlows: bySpec("capital")?.readyRows ?? 0,
    },
  };
};

export const ImportService = { preview };
