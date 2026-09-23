import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * Reading an agency's own spreadsheet before importing it.
 *
 * The workbook built here is not a tidy one. It carries what real copies carry
 * and what broke the first version of the reader: a summary block above the
 * table whose labels look like headings, money split across two cells with the
 * currency symbol in the first, dates as Excel serial numbers, and a row with
 * a hole in it.
 */

let t: TestApp;
let owner: Session;
let operator: Session;

/** 1 Jan 2025 and 8 Jan 2025 as Google exports them. */
const SERIAL_ISSUE = 45658;
const SERIAL_TRAVEL = 45665;

const buildWorkbook = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();

  const readMe = workbook.addWorksheet("Read Me ");
  readMe.addRow(["How to use this sheet"]);

  const sales = workbook.addWorksheet("Purchase and Sales");
  // The summary block: "Total Buying Amount" and "Status" read like headings,
  // and used to win the search for the real one.
  sales.addRow(["Total Buying Amount", "", "Total Selling Amount", "", "Status", "Pending"]);
  sales.addRow([]);
  sales.addRow([
    "#",
    "PNR *",
    "Issue Date *",
    "Short code *",
    "Airlines or Visa name",
    "Agency Name *",
    "Full Name *",
    "Phone",
    "Flight Date *",
    "Route",
    "Buying Price *",
    "",
    "Selling price *",
    "",
    "Payment received amount",
    "",
    "Received method *",
    "Status *",
  ]);
  // Money as the sheet stores it: the symbol in its own cell.
  sales.addRow([
    1,
    "5TFPET",
    SERIAL_ISSUE,
    "BS",
    "US-Bangla Airlines",
    "SkyFly Travels",
    "Arman Sultana",
    "01695617312",
    SERIAL_TRAVEL,
    "DAC-SIN",
    "৳",
    28872,
    "৳",
    31233,
    "৳",
    31233,
    "Bank Asia",
    "Delivered",
  ]);
  sales.addRow([
    2,
    "JQP3NZ",
    SERIAL_ISSUE,
    "BG",
    "Biman Bangladesh Airlines",
    "Global Wings Agency",
    "Sonia Ali",
    "01789629360",
    SERIAL_TRAVEL,
    "DAC-YYZ",
    "৳",
    145638,
    "৳",
    157442,
    "৳",
    0,
    "Cash",
    "Cancelled",
  ]);
  // A row with no issue date: importable rows must not include it.
  sales.addRow([
    3,
    "OKA1TU",
    "",
    "UL",
    "SriLankan Airlines",
    "DreamAir Holidays",
    "Nishat Karim",
    "01709785755",
    SERIAL_TRAVEL,
    "DAC-CMB",
    "৳",
    100,
    "৳",
    200,
    "৳",
    0,
    "Cash",
    "Pending",
  ]);

  const balances = workbook.addWorksheet("Balance Dashboard ");
  balances.addRow(["Balance Overview"]);
  balances.addRow(["Bank / Person Name", "Previous Amount +/-"]);
  balances.addRow(["bKash", "৳", 0]);
  // A section title and a stray header cell, the way a dashboard carries
  // them between its rows. Neither is an account.
  balances.addRow(["A D J U S T M E N T S"]);
  balances.addRow(["Date"]);

  const unknown = workbook.addWorksheet("Agent notes");
  unknown.addRow(["whatever the agency keeps here"]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

/** The API takes the file as multipart, which the JSON client cannot send. */
const postWorkbook = async (
  session: Session,
  file: Buffer,
  filename = "book.xlsx",
  path = "/imports/preview",
) => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename,
  );

  const response = await fetch(`${t.api.baseUrl}/api/v1${path}`, {
    method: "POST",
    headers: {
      Cookie: `accessToken=${session.accessToken}; better-auth.session_token=${session.token}`,
      "X-Forwarded-For": "10.9.9.9",
    },
    body: form,
  });

  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Import");
  operator = await t.api.loginOperator();
});
afterAll(() => t.close());

describe("reading an uploaded workbook", () => {
  it("finds the table under the summary block and reads it", async () => {
    const { status, body } = await postWorkbook(owner, await buildWorkbook());

    expect(status).toBe(200);
    const sales = body.data.tabs.find((tab: { kind: string }) => tab.kind === "sales");

    expect(sales.dataRows).toBe(3);
    // The row with no issue date is counted but not offered for import.
    expect(sales.readyRows).toBe(2);
    expect(sales.mapped.pnr).toBe("PNR *");
    expect(sales.mapped.fare).toBe("Selling price *");
  });

  it("reads money that is split across the symbol and the number", async () => {
    const { body } = await postWorkbook(owner, await buildWorkbook());
    const sales = body.data.tabs.find((tab: { kind: string }) => tab.kind === "sales");

    // 28,872 + 145,638 + 100 — the "৳" cells must not be read as the price.
    expect(sales.totals.cost).toBe(174_610);
    expect(sales.totals.fare).toBe(188_875);
    expect(sales.sample[0].cost).toBe(28_872);
  });

  it("turns Google's serial numbers back into dates", async () => {
    const { body } = await postWorkbook(owner, await buildWorkbook());
    const sales = body.data.tabs.find((tab: { kind: string }) => tab.kind === "sales");

    expect(sales.sample[0].issueDate).toBe("2025-01-01");
    expect(sales.sample[0].travelDate).toBe("2025-01-08");
  });

  it("says which row cannot be imported, and why", async () => {
    const { body } = await postWorkbook(owner, await buildWorkbook());
    const sales = body.data.tabs.find((tab: { kind: string }) => tab.kind === "sales");

    // Row 6 of the sheet: two summary rows, the header, then three data rows.
    expect(sales.problems).toEqual([
      expect.objectContaining({ row: 6, field: "issueDate" }),
    ]);
  });

  it("leaves the report tabs alone and does not guess at unknown ones", async () => {
    const { body } = await postWorkbook(owner, await buildWorkbook());

    expect(body.data.skipped).toContain("Read Me");
    expect(body.data.skipped).toContain("Agent notes");
    // The balance tab is data — the accounts come from it — so it is read,
    // while the report tabs and anything unrecognised are left alone.
    expect(body.data.tabs.map((tab: { tab: string }) => tab.tab).sort()).toEqual([
      "Balance Dashboard",
      "Purchase and Sales",
    ]);
  });

  it("counts what it would create without creating any of it", async () => {
    const { body } = await postWorkbook(owner, await buildWorkbook());

    expect(body.data.wouldCreate.tickets).toBe(2);
    expect(body.data.wouldCreate.customers).toBe(3);

    // Nothing was written: the agency is as empty as it was.
    const dashboard = await t.api.ok("GET", "/customers/dashboard", undefined, owner);
    expect(dashboard.summary.totalCustomers).toBe(0);
  });

  it("refuses a file that is not a spreadsheet", async () => {
    const { status } = await postWorkbook(owner, Buffer.from("not a workbook"), "notes.txt");

    // multer drops the file, so the request arrives without one.
    expect(status).toBe(400);
  });

  it("belongs to an agency admin, nobody else", async () => {
    // The platform operator has more power than anyone here and still
    // cannot run it: this writes into one agency's books, so it is theirs.
    const { status } = await postWorkbook(operator, await buildWorkbook());

    expect(status).toBe(403);
  });
});

describe("bringing the lists across", () => {
  it("creates the accounts, airlines, suppliers and customers the sheet names", async () => {
    const agency = await t.api.registerAgency("Foundations");

    const { status: code, body } = await postWorkbook(
      agency,
      await buildWorkbook(),
      "book.xlsx",
      "/imports/foundations",
    );

    expect(code).toBe(201);
    // Bank Asia and Cash from the sales rows, bKash from the balance tab.
    expect(body.data.counts.accounts).toBe(3);
    expect(body.data.counts.suppliers).toBe(3);
    expect(body.data.counts.customers).toBe(3);

    const customers = await t.api.ok("GET", "/customers/dashboard", undefined, agency);
    expect(customers.summary.totalCustomers).toBe(3);

    const accounts = await t.api.ok("GET", "/accounts", undefined, agency);
    // The section title and the stray header are not accounts, whatever
    // column they happen to sit in.
    expect(accounts.data.map((account: { name: string }) => account.name).sort()).toEqual([
      "Bank Asia",
      "Cash",
      "bKash",
    ]);
  });

  it("adds nothing the second time the same file is imported", async () => {
    const agency = await t.api.registerAgency("Twice");
    const file = await buildWorkbook();

    await postWorkbook(agency, file, "book.xlsx", "/imports/foundations");
    const { body } = await postWorkbook(agency, file, "book.xlsx", "/imports/foundations");

    // Everything matched what was already there, so nothing was created —
    // which is what makes it safe to fix a few rows and run it again.
    expect(body.data.counts).toMatchObject({
      accounts: 0,
      suppliers: 0,
      customers: 0,
      airlines: 0,
    });

    const customers = await t.api.ok("GET", "/customers/dashboard", undefined, agency);
    expect(customers.summary.totalCustomers).toBe(3);
  });

  it("keeps what the agency typed in itself", async () => {
    const agency = await t.api.registerAgency("Existing");
    await t.api.ok("POST", "/accounts", { name: "Cash", openingBalance: 5000 }, agency);

    const { body } = await postWorkbook(
      agency,
      await buildWorkbook(),
      "book.xlsx",
      "/imports/foundations",
    );

    // The sheet also has a "Cash" account; the one already in the books wins,
    // with its balance untouched.
    expect(body.data.counts.accounts).toBe(2);

    const accounts = await t.api.ok("GET", "/accounts", undefined, agency);
    const cash = accounts.data.find((account: { name: string }) => account.name === "Cash");
    expect(cash.currentBalance).toBe(5000);
  });

  it("can be undone, and says so afterwards", async () => {
    const agency = await t.api.registerAgency("Undo");

    const { body: imported } = await postWorkbook(
      agency,
      await buildWorkbook(),
      "book.xlsx",
      "/imports/foundations",
    );

    const undone = await t.api.ok(
      "DELETE",
      `/imports/${imported.data.importId}`,
      undefined,
      agency,
    );
    expect(undone.status).toBe("REVERTED");

    const customers = await t.api.ok("GET", "/customers/dashboard", undefined, agency);
    expect(customers.summary.totalCustomers).toBe(0);

    const accounts = await t.api.ok("GET", "/accounts", undefined, agency);
    expect(accounts.data).toEqual([]);

    // The run itself stays on the list: what happened is part of the record.
    const runs = await t.api.ok("GET", "/imports", undefined, agency);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "REVERTED", stage: "FOUNDATIONS" });

    const again = await t.api.delete(`/imports/${imported.data.importId}`, agency);
    expect(again.status).toBe(400);
  });
});
