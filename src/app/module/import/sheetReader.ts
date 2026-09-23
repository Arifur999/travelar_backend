import ExcelJS from "exceljs";

/**
 * Reading an agency's own spreadsheet, as opposed to a file we designed.
 *
 * Everything here exists because of something real in the workbooks agencies
 * actually keep:
 *
 *  - The header is not row 1. Above it sit summary blocks, charts and merged
 *    title bars, so the header is found by looking for the row that carries
 *    the labels, not by counting.
 *  - A money column is often two physical columns: "৳" in one, the number in
 *    the next, merged so they look like one. Reading the mapped column alone
 *    gives you the currency symbol as the price.
 *  - Dates arrive as Excel serial numbers when the sheet has been through
 *    Google Sheets, and as real dates when it has not.
 *  - Rows carry helper values from the sheet's own formulas — bare numbers
 *    like 52 or 195, and #REF! where a formula has broken — which are not
 *    data and must not be imported as if they were.
 */

export type CellValue = string | number | Date | null;

export interface SheetRow {
  /** 1-based, as the spreadsheet shows it, so a problem can be pointed at. */
  number: number;
  cells: CellValue[];
}

export interface SheetData {
  name: string;
  /** 1-based row number of the header, or null when none was recognised. */
  headerRow: number | null;
  headers: string[];
  rows: SheetRow[];
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Serials outside this range are counts or ids, not dates. 2005 → 2065. */
const MIN_SERIAL = 38_000;
const MAX_SERIAL = 60_000;

const normalise = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

const cellValue = (cell: ExcelJS.Cell): CellValue => {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return value;

  // A formula cell carries its last computed result; a broken one carries an
  // error, which is not data.
  if (typeof value === "object") {
    if ("error" in value) return null;
    if ("result" in value) {
      const result = (value as ExcelJS.CellFormulaValue).result;
      if (result instanceof Date) return result;
      if (typeof result === "number" || typeof result === "string") return result;
      return null;
    }
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map((part) => part.text).join("");
    }
    if ("text" in value) return String((value as ExcelJS.CellHyperlinkValue).text ?? "");
  }

  return null;
};

export const readWorkbook = async (file: Buffer): Promise<SheetData[]> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as unknown as ArrayBuffer);

  return workbook.worksheets.map((sheet) => {
    const rows: SheetRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: CellValue[] = [];
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        cells[columnNumber - 1] = cellValue(cell);
      });
      rows.push({ number: rowNumber, cells });
    });

    return { name: sheet.name.trim(), headerRow: null, headers: [], rows };
  });
};

/**
 * The header is the row that matches the most of the columns we are looking
 * for — not the first row that matches a couple.
 *
 * The summary block above a table is full of label-like text: "Total
 * Withdraw", "Flight date change", "Select Name", and the tab's own title.
 * Taking the first row with two matches picked those every time, and every
 * column after it read one row too high. Scoring every row and keeping the
 * best is what finds the real heading, and a tie goes to the lower row,
 * because the summaries are always above the table.
 */
export const findHeaderRow = (rows: SheetRow[], labelGroups: string[][]): SheetRow | null => {
  const groups = labelGroups.map((labels) => labels.map(normalise));

  let best: { row: SheetRow; score: number } | null = null;

  for (const row of rows.slice(0, 40)) {
    const texts = row.cells
      .filter((cell): cell is string => typeof cell === "string")
      .map(normalise);
    if (texts.length === 0) continue;

    // One point per column we were looking for that this row names, so a
    // row cannot win by repeating the same word.
    const score = groups.filter((labels) =>
      texts.some((text) => labels.some((label) => text.includes(label))),
    ).length;

    if (score >= 2 && (!best || score >= best.score)) best = { row, score };
  }

  return best?.row ?? null;
};

/**
 * Column index for a label, by what the header says rather than by position —
 * every agency has added or moved a column, and a fixed index would read the
 * wrong one silently.
 *
 * Matching is loose on purpose: "Issue Date *", "issue date" and "Issue  Date"
 * are the same column to a person, so they are the same column here.
 */
export const columnOf = (header: SheetRow, labels: string[]): number | null => {
  const wanted = labels.map(normalise);

  for (let index = 0; index < header.cells.length; index += 1) {
    const cell = header.cells[index];
    if (typeof cell !== "string") continue;
    const text = normalise(cell);
    if (wanted.some((label) => text === label || text.startsWith(`${label} `) || text === `${label} *`))
      return index;
  }

  // Nothing matched exactly; fall back to "contains", which catches
  // "Payment received amount" for "payment received".
  for (let index = 0; index < header.cells.length; index += 1) {
    const cell = header.cells[index];
    if (typeof cell !== "string") continue;
    const text = normalise(cell);
    if (wanted.some((label) => text.includes(label))) return index;
  }

  return null;
};

/**
 * The number for a money column, taking the currency symbol into account.
 *
 * Looks at the mapped cell and, if it holds a symbol or nothing, the next two
 * — that is how a merged "৳ | 31,233" pair reads once the merge is gone.
 */
export const moneyAt = (row: SheetRow, index: number | null): number | null => {
  if (index === null) return null;

  for (let offset = 0; offset <= 2; offset += 1) {
    const cell = row.cells[index + offset];
    if (typeof cell === "number" && Number.isFinite(cell)) return cell;
    if (typeof cell === "string") {
      const cleaned = cell.replace(/[৳$,\s]/g, "");
      if (cleaned === "") continue; // a lone currency symbol: keep looking
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
      return null; // real text in a money column is a problem, not a zero
    }
  }

  return null;
};

export const textAt = (row: SheetRow, index: number | null): string | null => {
  if (index === null) return null;
  const cell = row.cells[index];
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date) return cell.toISOString();
  const text = String(cell).trim();
  return text === "" ? null : text;
};

/**
 * A date, whether the sheet kept it as a date or as the serial number Google
 * exports. Serials are checked against a sane range so a row count or an id
 * never becomes 1907.
 */
export const dateAt = (row: SheetRow, index: number | null): Date | null => {
  if (index === null) return null;
  const cell = row.cells[index];

  if (cell instanceof Date) return cell;

  if (typeof cell === "number") {
    if (cell < MIN_SERIAL || cell > MAX_SERIAL) return null;
    return new Date(EXCEL_EPOCH_UTC + Math.round(cell) * MS_PER_DAY);
  }

  if (typeof cell === "string") {
    const trimmed = cell.trim();
    if (trimmed === "") return null;

    const serial = Number(trimmed);
    if (Number.isFinite(serial)) {
      if (serial < MIN_SERIAL || serial > MAX_SERIAL) return null;
      return new Date(EXCEL_EPOCH_UTC + Math.round(serial) * MS_PER_DAY);
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

/** Whether a row holds anything worth reading, given the columns that matter. */
export const hasAnyOf = (row: SheetRow, indexes: (number | null)[]) =>
  indexes.some((index) => index !== null && textAt(row, index) !== null);
