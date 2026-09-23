import status from "http-status";
import { CashAccountCategory, ImportStage } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { AirlineMasterService } from "../airlineMaster/airlineMaster.service.js";
import { CashAccountService } from "../cashAccount/cashAccount.service.js";
import { CustomerService } from "../customer/customer.service.js";
import { ExpenseService } from "../expense/expense.service.js";
import { RouteMasterService } from "../routeMaster/routeMaster.service.js";
import { SupplierService } from "../supplier/supplier.service.js";
import { isImportableTab, TAB_SPECS } from "./import.constant.js";
import { IFoundationsResult, IImportedRecord, IRunContext } from "./import.interface.js";
import { ImportRunService } from "./importRun.service.js";
import {
  columnOf,
  findHeaderRow,
  readWorkbook,
  textAt,
  type SheetData,
  type SheetRow,
} from "./sheetReader.js";

/**
 * Bringing across the lists a spreadsheet's history points at: the accounts
 * money moved through, the categories it was spent under, the airlines, the
 * agencies bought from and the people sold to.
 *
 * These come first and alone, because everything in the history refers to
 * them by name. Importing a ticket before its supplier exists means either
 * inventing a supplier halfway through or dropping the row.
 *
 * Nothing is created twice. An account, supplier or customer already in the
 * books is matched and left alone, so running the same file again adds
 * nothing — which is what makes it safe to fix a few rows and re-run.
 *
 * Every write goes through the module's own service, never straight to the
 * table: creating an account posts its opening balance, and bypassing that
 * would leave a balance the ledger cannot explain.
 */

const normalise = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

/** A phone as a key: digits only, so 017-1234 and 0171234 are one person. */
const phoneKey = (phone: string | null) => (phone ? phone.replace(/\D/g, "") : "");

const sheetFor = (sheets: SheetData[], kind: string): SheetData | undefined => {
  const spec = TAB_SPECS.find((candidate) => candidate.kind === kind);
  if (!spec) return undefined;
  return sheets.find((sheet) =>
    spec.tabNames.some((name) => normalise(sheet.name).includes(name)),
  );
};

/** Header plus the column indexes a caller asked for, or null when unreadable. */
const readTable = (sheet: SheetData | undefined, groups: string[][]) => {
  if (!sheet) return null;
  const header = findHeaderRow(sheet.rows, groups);
  if (!header) return null;

  const rows = sheet.rows.filter((row) => row.number > header.number);
  return { header, rows };
};

const valuesUnder = (
  table: { header: SheetRow; rows: SheetRow[] } | null,
  labels: string[],
): { value: string; row: number }[] => {
  if (!table) return [];
  const index = columnOf(table.header, labels);
  if (index === null) return [];

  const found: { value: string; row: number }[] = [];
  for (const row of table.rows) {
    const value = textAt(row, index);
    if (value) found.push({ value, row: row.number });
  }
  return found;
};

/**
 * Words that are never an account, however they are laid out.
 *
 * A balance dashboard is a report: between its account rows sit section
 * titles and stray header cells, and the first run of this import turned
 * "Date" and "A D J U S T M E N T S" into accounts in the agency's books.
 */
const HEADING_WORDS = new Set([
  "date",
  "name",
  "account",
  "accounts",
  "amount",
  "total",
  "balance",
  "details",
  "adjustments",
  "adjustment",
  "opening",
  "previous amount",
  "bank / person name",
  "method",
  "methode",
]);

const looksLikeHeading = (value: string) => {
  const text = normalise(value);
  if (HEADING_WORDS.has(text)) return true;
  if (!/[a-z]/i.test(text)) return true;

  // "A D J U S T M E N T S" is a title someone spaced out by hand. Letters
  // standing alone like that are never a bank's name.
  const tokens = text.split(" ");
  const single = tokens.filter((token) => token.length === 1).length;
  return tokens.length >= 4 && single / tokens.length > 0.6;
};

/**
 * Cash and bank accounts.
 *
 * Taken from every tab that names one, not just the account list: the history
 * pays into "DBBL" and out of "Cash", and a payment whose account does not
 * exist cannot be imported at all. Opening balances stay at zero — the
 * history being imported on top is what builds each balance up, and an
 * opening balance as well would count the same money twice.
 */
const collectAccountNames = (sheets: SheetData[]) => {
  const names = new Map<string, { name: string; tab: string; row: number }>();

  const add = (value: string, tab: string, row: number) => {
    const key = normalise(value);
    if (!key || key.length > 80) return;
    if (looksLikeHeading(value)) return;
    if (!names.has(key)) names.set(key, { name: value.trim(), tab, row });
  };

  const sources: [SheetData | undefined, string[][], string[]][] = [
    [sheetFor(sheets, "accounts"), [["bank / person name", "bank name"], ["previous amount", "opening"]], ["bank / person name", "bank name", "account"]],
    [sheetFor(sheets, "sales"), [["pnr"], ["received method", "payment method"]], ["received method", "payment method"]],
    [sheetFor(sheets, "collections"), [["customer"], ["to account"]], ["to account", "account"]],
    [sheetFor(sheets, "supplierPayments"), [["agency name"], ["bank account"]], ["bank account", "from account"]],
    [sheetFor(sheets, "expenses"), [["category"], ["form account", "from account"]], ["form account", "from account", "account"]],
  ];

  for (const [sheet, groups, labels] of sources) {
    const table = readTable(sheet, groups);
    for (const { value, row } of valuesUnder(table, labels)) {
      add(value, sheet?.name ?? "", row);
    }
  }

  return [...names.values()];
};

const importAccounts = async (
  agencyId: string,
  sheets: SheetData[],
  user: IRequestUser,
  recorded: IImportedRecord[],
  report: IRunContext["report"],
) => {
  const existing = await prisma.cashAccount.findMany({
    where: { agencyId },
    select: { id: true, name: true },
  });
  const known = new Set(existing.map((account) => normalise(account.name)));

  const wanted = collectAccountNames(sheets);
  let created = 0;
  let seen = 0;

  for (const account of wanted) {
    report("Accounts", (seen += 1), wanted.length);
    if (known.has(normalise(account.name))) continue;

    const madeAccount = await CashAccountService.createCashAccount(
      agencyId,
      {
        name: account.name,
        // The categories here group accounts by where the money came from,
        // and a spreadsheet does not say. SALES_BUYING is where the money
        // an agency trades with sits, which is what these accounts hold.
        category: CashAccountCategory.SALES_BUYING,
        openingBalance: 0,
      },
      user,
    );

    known.add(normalise(account.name));
    created += 1;
    recorded.push({
      entity: "cashAccount",
      entityId: madeAccount.id,
      sourceTab: account.tab,
      sourceRow: account.row,
    });
  }

  return created;
};

const importExpenseCategories = async (
  agencyId: string,
  sheets: SheetData[],
  recorded: IImportedRecord[],
  report: IRunContext["report"],
) => {
  const table = readTable(sheetFor(sheets, "expenses"), [
    ["category"],
    ["amount"],
    ["form account", "from account"],
  ]);
  const names = valuesUnder(table, ["category"]);

  const existing = await prisma.expenseCategory.findMany({
    where: { agencyId, isDeleted: false },
    select: { name: true },
  });
  const known = new Set(existing.map((category) => normalise(category.name)));

  let created = 0;
  let seen = 0;

  for (const { value, row } of names) {
    report("Expense categories", (seen += 1), names.length);
    if (known.has(normalise(value))) continue;

    const category = await ExpenseService.createCategory(agencyId, { name: value });
    known.add(normalise(value));
    created += 1;
    recorded.push({ entity: "expenseCategory", entityId: category.id, sourceRow: row });
  }

  return created;
};

const importAirlines = async (
  agencyId: string,
  sheets: SheetData[],
  user: IRequestUser,
  recorded: IImportedRecord[],
  report: IRunContext["report"],
) => {
  const sheet = sheetFor(sheets, "masterData");
  const table = readTable(sheet, [
    ["short code"],
    ["airlines name", "airlines or visa name", "airlines company name"],
  ]);
  if (!table) return 0;

  const codeIndex = columnOf(table.header, ["short code"]);
  const nameIndex = columnOf(table.header, [
    "airlines company name",
    "airlines name",
    "airlines or visa name",
  ]);
  const logoIndex = columnOf(table.header, ["logo url"]);

  const existing = await prisma.airlineMaster.findMany({
    where: { agencyId, isDeleted: false },
    select: { name: true, shortCode: true },
  });
  const knownCodes = new Set(existing.map((airline) => normalise(airline.shortCode)));
  const knownNames = new Set(existing.map((airline) => normalise(airline.name)));

  let created = 0;
  let seen = 0;

  for (const row of table.rows) {
    report("Airlines", (seen += 1), table.rows.length);
    const code = textAt(row, codeIndex);
    const name = textAt(row, nameIndex);
    if (!code || !name) continue;
    if (knownCodes.has(normalise(code)) || knownNames.has(normalise(name))) continue;

    const logoUrl = textAt(row, logoIndex);
    const airline = await AirlineMasterService.createAirline(
      agencyId,
      {
        name,
        shortCode: code,
        // The agency curated these logos themselves; they are part of what
        // they are moving in.
        logoUrl: logoUrl && logoUrl.startsWith("http") ? logoUrl : undefined,
      },
      user,
    );

    knownCodes.add(normalise(code));
    knownNames.add(normalise(name));
    created += 1;
    recorded.push({
      entity: "airline",
      entityId: airline.id,
      sourceTab: sheet?.name,
      sourceRow: row.number,
    });
  }

  return created;
};

const importSuppliers = async (
  agencyId: string,
  sheets: SheetData[],
  user: IRequestUser,
  recorded: IImportedRecord[],
  report: IRunContext["report"],
) => {
  const masterData = sheetFor(sheets, "masterData");
  const masterTable = readTable(masterData, [["agency name"], ["contact name"]]);

  // The master list has the contact and address; the other tabs only have the
  // name, and a supplier that only ever appears on a payment still has to
  // exist for that payment to import.
  const details = new Map<string, { name: string; contactName?: string; phone?: string; address?: string; row: number }>();

  if (masterTable) {
    const nameIndex = columnOf(masterTable.header, ["agency name"]);
    const contactIndex = columnOf(masterTable.header, ["contact name"]);
    const phoneIndex = columnOf(masterTable.header, ["phone"]);
    const addressIndex = columnOf(masterTable.header, ["address"]);

    for (const row of masterTable.rows) {
      const name = textAt(row, nameIndex);
      if (!name) continue;
      const key = normalise(name);
      if (details.has(key)) continue;
      details.set(key, {
        name,
        contactName: textAt(row, contactIndex) ?? undefined,
        phone: textAt(row, phoneIndex) ?? undefined,
        address: textAt(row, addressIndex) ?? undefined,
        row: row.number,
      });
    }
  }

  const otherSources: [SheetData | undefined, string[][]][] = [
    [sheetFor(sheets, "sales"), [["pnr"], ["agency name"]]],
    [sheetFor(sheets, "supplierPayments"), [["agency name"], ["amount"]]],
  ];

  for (const [sheet, groups] of otherSources) {
    const table = readTable(sheet, groups);
    for (const { value, row } of valuesUnder(table, ["agency name"])) {
      const key = normalise(value);
      if (!details.has(key)) details.set(key, { name: value, row });
    }
  }

  const existing = await prisma.supplier.findMany({
    where: { agencyId, isDeleted: false },
    select: { name: true },
  });
  const known = new Set(existing.map((supplier) => normalise(supplier.name)));

  let created = 0;
  let seen = 0;

  for (const supplier of details.values()) {
    report("Suppliers", (seen += 1), details.size);
    if (known.has(normalise(supplier.name))) continue;

    const made = await SupplierService.createSupplier(
      agencyId,
      {
        name: supplier.name,
        contactName: supplier.contactName,
        phone: supplier.phone,
        address: supplier.address,
        // Zero, like the accounts: what is owed comes out of the purchases
        // and payments imported next.
        openingPayable: 0,
      },
      user,
    );

    known.add(normalise(supplier.name));
    created += 1;
    recorded.push({
      entity: "supplier",
      entityId: made.id,
      sourceTab: masterData?.name,
      sourceRow: supplier.row,
    });
  }

  return created;
};

/**
 * The sectors flown, as the agency writes them: "DAC-SIN", "YYZ-DAC-YYZ".
 *
 * They only exist on the sales rows, so the list is whatever those rows use.
 * A ticket can be imported without one, but then the agency loses the sector
 * on every historic booking — which is half of what they look a booking up by.
 */
const importRoutes = async (
  agencyId: string,
  sheets: SheetData[],
  user: IRequestUser,
  recorded: IImportedRecord[],
  report: IRunContext["report"],
) => {
  const sales = sheetFor(sheets, "sales");
  const table = readTable(sales, [["pnr"], ["route"], ["full name"]]);
  const names = valuesUnder(table, ["route"]);

  const existing = await prisma.routeMaster.findMany({
    where: { agencyId, isDeleted: false },
    select: { name: true },
  });
  const known = new Set(existing.map((route) => normalise(route.name)));

  let created = 0;
  let seen = 0;

  for (const { value, row } of names) {
    report("Routes", (seen += 1), names.length);
    const name = value.trim();
    if (name.length > 120 || known.has(normalise(name))) continue;
    if (looksLikeHeading(name)) continue;

    const route = await RouteMasterService.createRoute(agencyId, { name }, user);
    known.add(normalise(name));
    created += 1;
    recorded.push({ entity: "route", entityId: route.id, sourceTab: sales?.name, sourceRow: row });
  }

  return created;
};

/**
 * Customers, gathered from every tab that names one.
 *
 * Matched on the phone number where there is one, because that is the only
 * thing in these sheets that identifies a person: the same customer is
 * "Md. Rafiq", "Rafiq Islam" and "rafiq" on three rows, and importing three
 * customers would split their balance three ways.
 */
const importCustomers = async (
  agencyId: string,
  sheets: SheetData[],
  user: IRequestUser,
  recorded: IImportedRecord[],
  report: IRunContext["report"],
) => {
  interface Candidate {
    name: string;
    phone: string | null;
    passportNo?: string;
    address?: string;
    tab?: string;
    row: number;
  }

  const byKey = new Map<string, Candidate>();

  const collect = (
    sheet: SheetData | undefined,
    groups: string[][],
    nameLabels: string[],
    extras = false,
  ) => {
    const table = readTable(sheet, groups);
    if (!table) return;

    const nameIndex = columnOf(table.header, nameLabels);
    const phoneIndex = columnOf(table.header, ["phone"]);
    const passportIndex = extras ? columnOf(table.header, ["passport number", "passport"]) : null;
    const addressIndex = extras ? columnOf(table.header, ["address"]) : null;

    for (const row of table.rows) {
      const name = textAt(row, nameIndex);
      if (!name) continue;

      const phone = textAt(row, phoneIndex);
      const key = phoneKey(phone) || normalise(name);
      if (byKey.has(key)) continue;

      byKey.set(key, {
        name,
        phone,
        passportNo: passportIndex !== null ? (textAt(row, passportIndex) ?? undefined) : undefined,
        address: addressIndex !== null ? (textAt(row, addressIndex) ?? undefined) : undefined,
        tab: sheet?.name,
        row: row.number,
      });
    }
  };

  collect(sheetFor(sheets, "sales"), [["pnr"], ["full name"], ["phone"]], ["full name", "passenger"], true);
  collect(sheetFor(sheets, "collections"), [["customer"], ["amount"]], ["customer"]);

  const existing = await prisma.customer.findMany({
    where: { agencyId, isDeleted: false },
    select: { name: true, phone: true },
  });
  const knownPhones = new Set(existing.map((customer) => phoneKey(customer.phone)).filter(Boolean));
  const knownNames = new Set(existing.map((customer) => normalise(customer.name)));

  let created = 0;
  let index = 0;

  for (const candidate of byKey.values()) {
    index += 1;
    report("Customers", index, byKey.size);
    const key = phoneKey(candidate.phone);
    if (key && knownPhones.has(key)) continue;
    if (!key && knownNames.has(normalise(candidate.name))) continue;

    // A customer must have a phone here, and a few rows in these sheets have
    // none. A placeholder keeps the history attached to the right person
    // instead of dropping the row, and it is obvious on screen.
    const phone = candidate.phone ?? `no-phone-${index}`;

    const customer = await CustomerService.createCustomer(
      agencyId,
      {
        name: candidate.name,
        phone,
        passportNo: candidate.passportNo,
        address: candidate.address,
        openingDue: 0,
      },
      user,
    );

    if (key) knownPhones.add(key);
    knownNames.add(normalise(candidate.name));
    created += 1;
    recorded.push({
      entity: "customer",
      entityId: customer.id,
      sourceTab: candidate.tab,
      sourceRow: candidate.row,
    });
  }

  return created;
};

/**
 * Reads the workbook and creates the lists, in the order they depend on each
 * other, then writes down everything it made.
 *
 * Not one database transaction: creating an account posts to the ledger, and
 * a few hundred of those in a single transaction would hold locks across the
 * whole run. The import record is what makes it reversible instead — every
 * row created is listed against it, and the rollback walks that list.
 */
const importFoundations = async (
  agencyId: string,
  filename: string,
  file: Buffer,
  user: IRequestUser,
  ctx?: IRunContext,
): Promise<IFoundationsResult> => {
  if (!file || file.length === 0) throw new AppError(status.BAD_REQUEST, "The file is empty");

  let sheets: SheetData[];
  try {
    sheets = ctx?.sheets ?? (await readWorkbook(file, isImportableTab));
  } catch {
    throw new AppError(
      status.BAD_REQUEST,
      "This file could not be read as a spreadsheet. Export it from Google Sheets as Microsoft Excel (.xlsx) and try again.",
    );
  }

  const recorded: IImportedRecord[] = [];
  const report = ctx?.report ?? (() => {});

  const accounts = await importAccounts(agencyId, sheets, user, recorded, report);
  const expenseCategories = await importExpenseCategories(agencyId, sheets, recorded, report);
  const airlines = await importAirlines(agencyId, sheets, user, recorded, report);
  const routes = await importRoutes(agencyId, sheets, user, recorded, report);
  const suppliers = await importSuppliers(agencyId, sheets, user, recorded, report);
  const customers = await importCustomers(agencyId, sheets, user, recorded, report);

  const counts = { accounts, expenseCategories, airlines, routes, suppliers, customers };

  // Half of a longer run writes against the record that run already opened, so
  // the whole upload is one thing to undo.
  if (ctx) {
    await ImportRunService.attachRecords(agencyId, ctx.importId, recorded);
    return { importId: ctx.importId, filename, stage: "FOUNDATIONS", counts };
  }

  const importId = await ImportRunService.recordRun({
    agencyId,
    filename,
    stage: ImportStage.FOUNDATIONS,
    counts,
    user,
    recorded,
  });

  return { importId, filename, stage: "FOUNDATIONS", counts };
};

export const FoundationsImportService = { importFoundations };
