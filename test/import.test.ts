import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/app/lib/prisma.js";
import { readWorkbook } from "../src/app/module/import/sheetReader.js";
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
/** 3 Jan and 20 Jan: the day a flight was moved, and the day it moved to. */
const SERIAL_CHANGED = 45660;
const SERIAL_NEW_TRAVEL = 45677;

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
    "Date *",
    "New Date *",
    "Date Change Fee cost *",
    "",
    "Date Change customer Fee *",
    "",
    "Payment received amount *",
    "",
    "Received method *",
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
    SERIAL_CHANGED,
    SERIAL_NEW_TRAVEL,
    "৳",
    3000,
    "৳",
    5000,
    "৳",
    5000,
    "Cash",
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

  const collections = workbook.addWorksheet("Customer Transaction ");
  collections.addRow(["Customer Transaction"]);
  collections.addRow([]);
  collections.addRow(["#", "Date", "Customer", "Phone", "Amount", "", "To Account (+)", "Details"]);
  collections.addRow([1, SERIAL_TRAVEL, "Arman Sultana", "01695617312", "৳", 10000, "bKash", "On account"]);

  const supplierPayments = workbook.addWorksheet("Agency Transaction ");
  supplierPayments.addRow(["Agency Transaction"]);
  supplierPayments.addRow([]);
  supplierPayments.addRow(["#", "Date", "Agency Name", "Contact  Name", "Amount", "", "bank Account (-)", "Details"]);
  supplierPayments.addRow([1, SERIAL_TRAVEL, "SkyFly Travels", "Rafiq Islam", "৳", 20000, "Bank Asia", "January"]);

  // Three blocks on one heading row, two of them headed "Amount". The left
  // one is a category's whole year; only the middle one is an expense.
  const expenses = workbook.addWorksheet("Expense");
  expenses.addRow(["Expense Summary", "", "", "", "Expense Transaction"]);
  expenses.addRow([]);
  expenses.addRow([
    "Expense Category ",
    "",
    "Amount",
    "",
    "#",
    "Date",
    "Form Account (-)",
    "",
    "Amount",
    "Category",
    "Details",
  ]);
  expenses.addRow([
    "Utility Bills",
    "৳",
    20700,
    "",
    1,
    SERIAL_TRAVEL,
    "Cash",
    "৳",
    1200,
    "Utility Bills",
    "January wifi",
  ]);

  // Money in and money out in two columns side by side; a row fills one.
  const capital = workbook.addWorksheet("InvestWithdraw ");
  capital.addRow(["T R A N S A C T I O N S"]);
  capital.addRow(["New Invest", "", "Total Withdraw"]);
  capital.addRow(["#", "Date", "Name", "Investment", "", "Withdraw", "", "Deposited Acc +/-", "Details "]);
  capital.addRow([1, SERIAL_ISSUE, "Hasan", "৳", 1000000, "৳", "", "Cash", "Opening capital"]);
  capital.addRow([2, SERIAL_TRAVEL, "Hasan", "৳", "", "৳", 300000, "Cash", "Owner draw"]);

  const profit = workbook.addWorksheet("Profit Withdraw");
  profit.addRow(["Profit Withdrow Summary", "", "", "", "", "Profit Withdrow Transaction"]);
  profit.addRow([]);
  profit.addRow([
    "Profit Withdraw Person",
    "",
    "Amount",
    "",
    "#",
    "Date",
    "Form Account (-)",
    "",
    "Amount",
    "Received person",
    "Details",
  ]);
  profit.addRow(["Hasan", "৳", 50000, "", 1, SERIAL_TRAVEL, "Cash", "৳", 50000, "Hasan", "Monthly"]);

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
      "Agency Transaction",
      "Balance Dashboard",
      "Customer Transaction",
      "Expense",
      "InvestWithdraw",
      "Profit Withdraw",
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

/**
 * Writing the history on top of the lists.
 *
 * The figures asserted here are the whole point of the feature: an owner who
 * uploads a year of business checks the balances afterwards, and if they do not
 * match the spreadsheet they were keeping, nothing else about the app matters.
 */
describe("bringing the history across", () => {
  /** An agency with its lists already in, ready for the history. */
  const readyAgency = async (name: string) => {
    const agency = await t.api.registerAgency(name);
    const file = await buildWorkbook();
    await postWorkbook(agency, file, "book.xlsx", "/imports/foundations");
    return { agency, file };
  };

  const balanceOf = async (agency: Session, name: string) => {
    const accounts = await t.api.ok("GET", "/accounts", undefined, agency);
    return accounts.data.find((account: { name: string }) => account.name === name)?.currentBalance;
  };

  it("writes the sales, the money taken on them and everything else", async () => {
    const { agency, file } = await readyAgency("History");

    const { status: code, body } = await postWorkbook(agency, file, "book.xlsx", "/imports/history");

    expect(code).toBe(201);
    expect(body.data.counts).toMatchObject({
      tickets: 2,
      // The full payment on the first sale, then the payment on its date
      // change — one row, two payments.
      ticketPayments: 2,
      dateChanges: 1,
      collections: 1,
      supplierPayments: 1,
      expenses: 1,
      capitalFlows: 2,
      profitWithdrawals: 1,
    });

    // The row with no issue date is reported with its number, not guessed at.
    expect(body.data.problems).toEqual([
      expect.objectContaining({ tab: "Purchase and Sales", row: 6, field: "ticket" }),
    ]);
  });

  it("leaves every account holding exactly what the sheet says it should", async () => {
    const { agency, file } = await readyAgency("Balances");
    await postWorkbook(agency, file, "book.xlsx", "/imports/history");

    // Cash: 1,000,000 invested, 300,000 drawn back out, 5,000 taken for the
    // date change, 1,200 of wifi and 50,000 of profit out.
    expect(await balanceOf(agency, "Cash")).toBe(653_800);
    // Bank Asia: the 31,233 sale, less the 20,000 paid to the supplier.
    expect(await balanceOf(agency, "Bank Asia")).toBe(11_233);
    expect(await balanceOf(agency, "bKash")).toBe(10_000);
  });

  it("reads the expense from the table, not from the summary beside it", async () => {
    const { agency, file } = await readyAgency("Expense column");
    const { body } = await postWorkbook(agency, file, "book.xlsx", "/imports/history");

    // The tab heads two columns "Amount": the left one is a category's whole
    // year (20,700), the right one the single expense (1,200). Reading the
    // wrong one is silent, and wrong by a factor of seventeen.
    expect(body.data.totals.expenses).toBe(1200);
  });

  it("puts the profit it wrote next to the one the spreadsheet printed", async () => {
    const { agency, file } = await readyAgency("Totals");
    const { body } = await postWorkbook(agency, file, "book.xlsx", "/imports/history");

    expect(body.data.totals).toMatchObject({
      cost: 174_510,
      fare: 188_675,
      dateChangeCost: 3000,
      dateChangeFee: 5000,
      // 188,675 + 5,000 − 174,510 − 3,000.
      profit: 16_165,
      invested: 1_000_000,
      withdrawn: 300_000,
    });
  });

  it("adds nothing the second time the same file is imported", async () => {
    const { agency, file } = await readyAgency("History twice");
    await postWorkbook(agency, file, "book.xlsx", "/imports/history");

    const { body } = await postWorkbook(agency, file, "book.xlsx", "/imports/history");

    expect(body.data.counts.tickets).toBeUndefined();
    expect(body.data.skipped).toMatchObject({
      tickets: 2,
      collections: 1,
      supplierPayments: 1,
      expenses: 1,
      capitalFlows: 2,
      profitWithdrawals: 1,
    });

    // The balances are where the first run left them, not doubled.
    expect(await balanceOf(agency, "Cash")).toBe(653_800);
  });

  it("takes the money back out of the ledger when it is undone", async () => {
    const { agency, file } = await readyAgency("History undo");
    const { body } = await postWorkbook(agency, file, "book.xlsx", "/imports/history");

    const undone = await t.api.ok("DELETE", `/imports/${body.data.importId}`, undefined, agency);
    expect(undone.status).toBe("REVERTED");

    // A posting carries no foreign key to what caused it, so nothing about
    // deleting a payment removes its entry from the ledger. If the rollback
    // does not clear them itself, the money stays on the balance sheet with
    // no row left in the app that explains it.
    expect(await balanceOf(agency, "Cash")).toBe(0);
    expect(await balanceOf(agency, "Bank Asia")).toBe(0);
    expect(await balanceOf(agency, "bKash")).toBe(0);

    const tickets = await t.api.ok("GET", "/ticketing", undefined, agency);
    expect(tickets.tickets).toEqual([]);
    // Not only gone from the list: the sales they were counted in are gone
    // from the figures the dashboard cards read.
    expect(tickets.summary).toMatchObject({ totalSales: 0, totalPaid: 0 });

    // The lists it was written on top of are untouched: they were a different
    // run, and undoing one import must not take another with it.
    const customers = await t.api.ok("GET", "/customers/dashboard", undefined, agency);
    expect(customers.summary.totalCustomers).toBe(3);
  });

  it("refuses to run before the lists exist", async () => {
    const agency = await t.api.registerAgency("No lists");

    const { status: code, body } = await postWorkbook(
      agency,
      await buildWorkbook(),
      "book.xlsx",
      "/imports/history",
    );

    expect(code).toBe(400);
    expect(body.message).toMatch(/lists/i);
  });
});

/**
 * The one button an agency actually presses.
 *
 * A year of business takes minutes to write, so the upload cannot be the thing
 * that waits for it. What is tested here is the promise that makes that
 * bearable: it starts, it says how far it has got, it finishes, it refuses the
 * same file twice, and all of it comes back out again in one go.
 */
describe("bringing the whole workbook across in one run", () => {
  const startRun = async (agency: Session, file: Buffer, force = false) => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(file)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "book.xlsx",
    );
    if (force) form.append("force", "true");

    const response = await fetch(`${t.api.baseUrl}/api/v1/imports/run`, {
      method: "POST",
      headers: {
        Cookie: `accessToken=${agency.accessToken}; better-auth.session_token=${agency.token}`,
        "X-Forwarded-For": "10.9.9.9",
      },
      body: form,
    });

    return { status: response.status, body: await response.json() };
  };

  /** The run outlives the request, so the test waits for it like the screen does. */
  const settle = async (agency: Session, importId: string) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const run = await t.api.ok("GET", `/imports/${importId}`, undefined, agency);
      if (run.status !== "RUNNING") return run;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("the import never finished");
  };

  it("answers before the work is done, then finishes it", async () => {
    const agency = await t.api.registerAgency("One run");

    const { status: code, body } = await startRun(agency, await buildWorkbook());

    // 202: started, not finished. The id is what the screen follows.
    expect(code).toBe(202);
    expect(body.data.alreadyImported).toBeNull();

    const run = await settle(agency, body.data.importId);

    expect(run.status).toBe("COMPLETED");
    expect(run.stage).toBe("EVERYTHING");
    expect(run.counts).toMatchObject({
      accounts: 3,
      customers: 3,
      tickets: 2,
      collections: 1,
      supplierPayments: 1,
      expenses: 1,
      capitalFlows: 2,
    });

    // Both halves went into one record, so there is one thing to undo.
    const runs = await t.api.ok("GET", "/imports", undefined, agency);
    expect(runs).toHaveLength(1);
  });

  it("says how far it has got while it is going, and reaches the end", async () => {
    const agency = await t.api.registerAgency("Progress");
    const { body } = await startRun(agency, await buildWorkbook());

    const run = await settle(agency, body.data.importId);

    // The bar is counted, not guessed: a named step, a row count, and a
    // hundred per cent only once there is nothing left to do.
    expect(run.progress).toMatchObject({ percent: 100, stepCount: 12 });
    expect(typeof run.progress.step).toBe("string");
  });

  it("keeps the report, so it can be read again tomorrow", async () => {
    const agency = await t.api.registerAgency("Report kept");
    const { body } = await startRun(agency, await buildWorkbook());

    const run = await settle(agency, body.data.importId);

    expect(run.result.totals).toMatchObject({ profit: 16_165, expenses: 1200 });
    expect(run.result.problems).toEqual([
      expect.objectContaining({ tab: "Purchase and Sales", row: 6 }),
    ]);
  });

  it("says the file is already in rather than importing it twice", async () => {
    const agency = await t.api.registerAgency("Same file");
    const file = await buildWorkbook();

    const first = await startRun(agency, file);
    await settle(agency, first.body.data.importId);

    const again = await startRun(agency, file);

    // Not an error and not a second import: the same run, named, with the day
    // it happened — which is the answer to "did I already do this?".
    expect(again.status).toBe(200);
    expect(again.body.data.alreadyImported).toMatchObject({
      id: first.body.data.importId,
      status: "COMPLETED",
    });

    const runs = await t.api.ok("GET", "/imports", undefined, agency);
    expect(runs).toHaveLength(1);
  });

  it("runs the same file again when it is asked twice", async () => {
    const agency = await t.api.registerAgency("Forced");
    const file = await buildWorkbook();

    const first = await startRun(agency, file);
    await settle(agency, first.body.data.importId);

    const forced = await startRun(agency, file, true);
    expect(forced.status).toBe(202);
    const second = await settle(agency, forced.body.data.importId);

    // A second run, but nothing doubled: every row was recognised and skipped.
    expect(second.result.skipped).toMatchObject({ tickets: 2, expenses: 1 });
    const accounts = await t.api.ok("GET", "/accounts", undefined, agency);
    const cash = accounts.data.find((account: { name: string }) => account.name === "Cash");
    expect(cash.currentBalance).toBe(653_800);
  });

  it("puts everything back the way it was", async () => {
    const agency = await t.api.registerAgency("One undo");
    const { body } = await startRun(agency, await buildWorkbook());
    await settle(agency, body.data.importId);

    const undone = await t.api.ok(
      `DELETE` as "DELETE",
      `/imports/${body.data.importId}`,
      undefined,
      agency,
    );

    expect(undone.status).toBe("REVERTED");

    // Lists and history both, because both were this one run.
    const accounts = await t.api.ok("GET", "/accounts", undefined, agency);
    expect(accounts.data).toEqual([]);

    const customers = await t.api.ok("GET", "/customers/dashboard", undefined, agency);
    expect(customers.summary.totalCustomers).toBe(0);
  });
});

/**
 * What happens to a run when the process doing it goes away.
 *
 * This is not hypothetical: the first real workbook put the API over the
 * memory its container allowed, and the kernel killed it a step into the
 * import. The record was left saying RUNNING, the screen showed a bar that
 * would never move again, and every import after it was refused because one
 * was supposedly already going. Recovering from that is part of the feature.
 */
describe("a run whose server went away", () => {
  const startRun = async (agency: Session, file: Buffer) => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(file)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
      "book.xlsx",
    );
    form.append("force", "true");

    const response = await fetch(`${t.api.baseUrl}/api/v1/imports/run`, {
      method: "POST",
      headers: {
        Cookie: `accessToken=${agency.accessToken}; better-auth.session_token=${agency.token}`,
        "X-Forwarded-For": "10.9.9.9",
      },
      body: form,
    });

    return { status: response.status, body: await response.json() };
  };

  /** As the database would look after the process was killed mid-run. */
  const pretendItDied = async (importId: string, minutesAgo: number) => {
    await prisma.$executeRawUnsafe(
      `UPDATE data_imports SET status = 'RUNNING', "updatedAt" = NOW() - INTERVAL '${minutesAgo} minutes' WHERE id = $1`,
      importId,
    );
  };

  it("is marked as stopped, not left running for ever", async () => {
    const agency = await t.api.registerAgency("Killed");
    const started = await startRun(agency, await buildWorkbook());

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const current = await t.api.ok("GET", `/imports/${started.body.data.importId}`, undefined, agency);
      if (current.status !== "RUNNING") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await pretendItDied(started.body.data.importId, 30);

    const run = await t.api.ok("GET", `/imports/${started.body.data.importId}`, undefined, agency);
    expect(run.status).toBe("FAILED");
    expect(run.note).toMatch(/restarted/i);
  });

  it("does not block the next import", async () => {
    const agency = await t.api.registerAgency("Killed twice");
    const file = await buildWorkbook();
    const started = await startRun(agency, file);

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const current = await t.api.ok("GET", `/imports/${started.body.data.importId}`, undefined, agency);
      if (current.status !== "RUNNING") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await pretendItDied(started.body.data.importId, 30);

    // Uploading again is the obvious thing to try, and it has to work: the
    // rows the dead run managed are recognised and skipped.
    const again = await startRun(agency, file);
    expect(again.status).toBe(202);
  });

  it("leaves a run that is genuinely still going alone", async () => {
    const agency = await t.api.registerAgency("Still going");
    const started = await startRun(agency, await buildWorkbook());

    for (let attempt = 0; attempt < 300; attempt += 1) {
      const current = await t.api.ok("GET", `/imports/${started.body.data.importId}`, undefined, agency);
      if (current.status !== "RUNNING") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // A minute of quiet is a busy step, not a dead process.
    await pretendItDied(started.body.data.importId, 1);

    const run = await t.api.ok("GET", `/imports/${started.body.data.importId}`, undefined, agency);
    expect(run.status).toBe("RUNNING");
  });
});

/**
 * How the workbook is read, which is what decides whether an import of
 * somebody's books can be trusted.
 */
describe("reading a workbook", () => {
  it("keeps only the sheets it is asked for", async () => {
    const file = await buildWorkbook();

    const some = await readWorkbook(file, (name) => name === "Expense");

    // Every sheet still comes back — the screen lists the ones it left alone —
    // but only the asked-for one carries its rows, and the rows are the cost.
    // Half of one of these files is the spreadsheet's own dashboards.
    expect(some.length).toBeGreaterThan(1);
    expect(some.filter((sheet) => sheet.rows.length > 0).map((sheet) => sheet.name)).toEqual([
      "Expense",
    ]);
  });

  it("reads every cell of a tab it keeps", async () => {
    const file = await buildWorkbook();

    const sheets = await readWorkbook(file);
    const sales = sheets.find((sheet) => sheet.name === "Purchase and Sales");

    // The text is the half that matters and the half that goes missing when a
    // reader gets ahead of the table those cells point into: a streaming read
    // was tried here and returned rows with every string null about three
    // times in a hundred, numbers intact. Names, PNRs and account names are
    // how every row in this import finds what it belongs to.
    const header = sales!.rows.find((row) => row.cells.includes("PNR *"));
    expect(header).toBeDefined();

    const first = sales!.rows.find((row) => row.cells.includes("5TFPET"));
    expect(first!.cells).toContain("Arman Sultana");
    expect(first!.cells).toContain("Bank Asia");
    expect(first!.cells).toContain(28_872);
  });

  it("treats a blank cell as nothing, whatever the file put there", async () => {
    const file = await buildWorkbook();

    const sheets = await readWorkbook(file);
    const sales = sheets.find((sheet) => sheet.name === "Purchase and Sales");
    const header = sales!.rows.find((row) => row.cells.includes("PNR *"));

    // The spacer columns between a currency symbol and its number are empty.
    // An empty string and a null are the same absence, and only one of them
    // should ever reach the rest of the import.
    expect(header!.cells).not.toContain("");
  });
});
