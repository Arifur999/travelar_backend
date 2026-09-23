import status from "http-status";
import {
  CapitalFlowType,
  ImportStage,
  TicketStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { CapitalService } from "../capital/capital.service.js";
import { DueReceivedService } from "../dueReceived/dueReceived.service.js";
import { ExpenseService } from "../expense/expense.service.js";
import { SupplierTransactionService } from "../supplierTransaction/supplierTransaction.service.js";
import { TicketService } from "../ticket/ticket.service.js";
import { ImportKind, TAB_SPECS, TICKET_STATUS_MAP } from "./import.constant.js";
import { IHistoryResult, IImportedRecord, IRunContext, ITabProblem } from "./import.interface.js";
import { ImportRunService } from "./importRun.service.js";
import {
  dateAt,
  findHeaderRow,
  moneyAt,
  readWorkbook,
  resolveColumns,
  textAt,
  type SheetData,
  type SheetRow,
} from "./sheetReader.js";

/**
 * The agency's trading history, written into its new books.
 *
 * The lists came first (foundations.service.ts) because every line here names
 * one: a ticket names its customer, its supplier and the account the money went
 * into, all by name and nothing else. This step matches those names to the
 * records already created, then writes the movements themselves — sales and
 * what was collected on them, money paid to suppliers, expenses, and what the
 * owners put in or took out.
 *
 * Three rules hold the whole thing together:
 *
 *  - **Every write goes through the module's own service.** A ticket payment
 *    put straight into the table would be money the ledger cannot explain, and
 *    the ledger is where the balances come from that this import will be
 *    judged against. Going through the services means the history gets the
 *    same arithmetic the app uses every day.
 *  - **Nothing is created twice.** Each kind of row has a natural key — a PNR
 *    and its issue date, a customer and a date and an amount — and a row
 *    already in the books is counted as skipped. So a file can be corrected
 *    and uploaded again without doubling anybody's balance.
 *  - **A row that cannot be written is reported, not guessed at.** No customer
 *    matched, no such account: the row is listed by the number the spreadsheet
 *    itself shows, and everything else still imports.
 */

const normalise = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
const phoneKey = (phone: string | null) => (phone ? phone.replace(/\D/g, "") : "");

/** A day, for comparing a sheet's date against one already in the books. */
const dayKey = (value: Date) => value.toISOString().slice(0, 10);

/** Money to the paisa, so 1000 and 1000.004 are the same payment. */
const moneyKey = (value: number) => value.toFixed(2);

interface Table {
  tab: string;
  columns: Map<string, number | null>;
  rows: SheetRow[];
}

const tableFor = (sheets: SheetData[], kind: ImportKind): Table | null => {
  const spec = TAB_SPECS.find((candidate) => candidate.kind === kind);
  if (!spec) return null;

  const sheet = sheets.find((candidate) =>
    spec.tabNames.some((name) => normalise(candidate.name).includes(name)),
  );
  if (!sheet) return null;

  const header = findHeaderRow(
    sheet.rows,
    spec.fields.map((field) => field.labels),
  );
  if (!header) return null;

  return {
    tab: sheet.name,
    columns: resolveColumns(header, spec.fields),
    rows: sheet.rows.filter((row) => row.number > header.number),
  };
};

const at = (table: Table, field: string) => table.columns.get(field) ?? null;
const textOf = (table: Table, row: SheetRow, field: string) => textAt(row, at(table, field));
const moneyOf = (table: Table, row: SheetRow, field: string) => moneyAt(row, at(table, field));
const dateOf = (table: Table, row: SheetRow, field: string) => dateAt(row, at(table, field));

/**
 * The lists the history points at, loaded once and looked up by name.
 *
 * A customer is found by phone before name, because a phone number is the only
 * thing in these sheets that identifies a person — the same buyer is written
 * three ways across a year of rows.
 */
interface Books {
  customer: (phone: string | null, name: string | null) => string | null;
  supplier: (name: string | null) => string | null;
  airline: (code: string | null, name: string | null) => string | null;
  route: (name: string | null) => string | null;
  account: (name: string | null) => string | null;
  category: (name: string | null) => string | null;
  addCategory: (name: string, id: string) => void;
}

const loadBooks = async (agencyId: string): Promise<Books> => {
  const [customers, suppliers, airlines, routes, accounts, categories] = await Promise.all([
    prisma.customer.findMany({
      where: { agencyId, isDeleted: false },
      select: { id: true, name: true, phone: true },
    }),
    prisma.supplier.findMany({ where: { agencyId, isDeleted: false }, select: { id: true, name: true } }),
    prisma.airlineMaster.findMany({
      where: { agencyId, isDeleted: false },
      select: { id: true, name: true, shortCode: true },
    }),
    prisma.routeMaster.findMany({ where: { agencyId, isDeleted: false }, select: { id: true, name: true } }),
    prisma.cashAccount.findMany({ where: { agencyId }, select: { id: true, name: true } }),
    prisma.expenseCategory.findMany({
      where: { agencyId, isDeleted: false },
      select: { id: true, name: true },
    }),
  ]);

  const byPhone = new Map(
    customers.filter((one) => phoneKey(one.phone)).map((one) => [phoneKey(one.phone), one.id]),
  );
  const customerByName = new Map(customers.map((one) => [normalise(one.name), one.id]));
  const supplierByName = new Map(suppliers.map((one) => [normalise(one.name), one.id]));
  const airlineByCode = new Map(airlines.map((one) => [normalise(one.shortCode), one.id]));
  const airlineByName = new Map(airlines.map((one) => [normalise(one.name), one.id]));
  const routeByName = new Map(routes.map((one) => [normalise(one.name), one.id]));
  const accountByName = new Map(accounts.map((one) => [normalise(one.name), one.id]));
  const categoryByName = new Map(categories.map((one) => [normalise(one.name), one.id]));

  const get = (map: Map<string, string>, value: string | null) =>
    value ? (map.get(normalise(value)) ?? null) : null;

  return {
    customer: (phone, name) => byPhone.get(phoneKey(phone)) ?? get(customerByName, name),
    supplier: (name) => get(supplierByName, name),
    airline: (code, name) => get(airlineByCode, code) ?? get(airlineByName, name),
    route: (name) => get(routeByName, name),
    account: (name) => get(accountByName, name),
    category: (name) => get(categoryByName, name),
    addCategory: (name, id) => categoryByName.set(normalise(name), id),
  };
};

/** Everything one run accumulates as it works through the tabs. */
interface Run {
  agencyId: string;
  user: IRequestUser;
  books: Books;
  report: IRunContext["report"];
  recorded: IImportedRecord[];
  problems: ITabProblem[];
  counts: Record<string, number>;
  skipped: Record<string, number>;
  totals: Record<string, number>;
}

/** Enough problems to see the pattern; a thousand identical ones help nobody. */
const MAX_PROBLEMS = 100;

const flag = (run: Run, tab: string, row: number, field: string, message: string) => {
  run.counts.problems = (run.counts.problems ?? 0) + 1;
  if (run.problems.length < MAX_PROBLEMS) run.problems.push({ tab, row, field, message });
};

const tally = (counts: Record<string, number>, key: string, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

/**
 * Air tickets, with the money taken on them.
 *
 * A sale row is four things at once: the ticket, what it cost and sold for, the
 * payment banked against it, and — further right, under its own heading — a
 * date change carrying a second fee and a second payment. They are written in
 * that order because each depends on the last: the fee raises what the customer
 * owes, and a payment can never exceed what is owed.
 */
const importTickets = async (run: Run, table: Table) => {
  const existing = await prisma.ticket.findMany({
    where: { agencyId: run.agencyId, isDeleted: false },
    select: { pnr: true, issueDate: true },
  });
  const seen = new Set(
    existing.map(
      (ticket) => `${normalise(ticket.pnr)}|${ticket.issueDate ? dayKey(ticket.issueDate) : ""}`,
    ),
  );

  let read = 0;

  for (const row of table.rows) {
    run.report("Air tickets", (read += 1), table.rows.length);
    const pnr = textOf(table, row, "pnr");
    if (!pnr) continue;

    const issueDate = dateOf(table, row, "issueDate");
    const passengerName = textOf(table, row, "passengerName");
    const cost = moneyOf(table, row, "cost");
    const fare = moneyOf(table, row, "fare");

    if (!issueDate || !passengerName || cost === null || fare === null) {
      flag(
        run,
        table.tab,
        row.number,
        "ticket",
        "Needs an issue date, a passenger, a buying price and a selling price",
      );
      continue;
    }

    const key = `${normalise(pnr)}|${dayKey(issueDate)}`;
    if (seen.has(key)) {
      tally(run.skipped, "tickets");
      continue;
    }

    const customerId = run.books.customer(textOf(table, row, "customerPhone"), passengerName);
    if (!customerId) {
      flag(
        run,
        table.tab,
        row.number,
        "customer",
        `No customer matches "${passengerName}" — bring the lists across first`,
      );
      continue;
    }

    const supplierName = textOf(table, row, "supplierName");
    const supplierId = run.books.supplier(supplierName);
    if (supplierName && !supplierId) {
      flag(run, table.tab, row.number, "supplier", `No supplier named "${supplierName}"`);
    }

    const ticket = await TicketService.createTicket(
      run.agencyId,
      {
        customerId,
        supplierId: supplierId ?? undefined,
        airlineId:
          run.books.airline(textOf(table, row, "airlineCode"), textOf(table, row, "airlineName")) ??
          undefined,
        routeId: run.books.route(textOf(table, row, "route")) ?? undefined,
        passengerName,
        pnr,
        issueDate: issueDate.toISOString(),
        travelDate: dateOf(table, row, "travelDate")?.toISOString(),
        fare,
        cost,
      },
      run.user,
    );

    seen.add(key);
    tally(run.counts, "tickets");
    tally(run.totals, "fare", fare);
    tally(run.totals, "cost", cost);
    run.recorded.push({
      entity: "ticket",
      entityId: ticket.id,
      sourceTab: table.tab,
      sourceRow: row.number,
    });

    const changeCost = moneyOf(table, row, "dateChangeCost") ?? 0;
    const changeFee = moneyOf(table, row, "dateChangeFee") ?? 0;
    const newTravelDate = dateOf(table, row, "newTravelDate");
    const changedAt = dateOf(table, row, "dateChangeDate");

    if (changeCost !== 0 || changeFee !== 0 || newTravelDate) {
      await TicketService.recordDateChange(run.agencyId, ticket.id, {
        dateChangedAt: (changedAt ?? issueDate).toISOString(),
        travelDate: newTravelDate?.toISOString(),
        dateChangeCost: changeCost,
        dateChangeFee: changeFee,
      });

      tally(run.counts, "dateChanges");
      tally(run.totals, "dateChangeFee", changeFee);
      tally(run.totals, "dateChangeCost", changeCost);
    }

    // What the customer owes on this ticket, which is the ceiling on what can
    // be taken against it. Both payments come off the same running figure, so
    // a sheet that over-collects is reported rather than stopping the run.
    let owed = fare + changeFee;

    const take = (amount: number | null, accountName: string | null, paidAt: Date, what: string) => {
      if (amount === null || amount <= 0) return null;

      const cashAccountId = run.books.account(accountName);
      if (!cashAccountId) {
        flag(
          run,
          table.tab,
          row.number,
          "account",
          `No account named "${accountName ?? "—"}" for the payment on ${what}`,
        );
        return null;
      }

      const taken = Math.min(amount, owed);
      if (taken < amount) {
        flag(
          run,
          table.tab,
          row.number,
          "payment",
          `The payment on ${what} is ${amount} but only ${owed} was owed — the rest was left off`,
        );
      }
      if (taken <= 0) return null;

      owed -= taken;
      return { cashAccountId, amount: taken, paidAt };
    };

    const payments = [
      take(moneyOf(table, row, "paidAmount"), textOf(table, row, "paidInto"), issueDate, "the sale"),
      take(
        moneyOf(table, row, "dateChangePaid"),
        textOf(table, row, "dateChangePaidInto"),
        changedAt ?? issueDate,
        "the date change",
      ),
    ];

    for (const payment of payments) {
      if (!payment) continue;

      await TicketService.recordPayment(
        run.agencyId,
        ticket.id,
        {
          cashAccountId: payment.cashAccountId,
          amount: payment.amount,
          paidAt: payment.paidAt.toISOString(),
          note: "Brought in from the agency's spreadsheet",
        },
        run.user,
      );

      // recordPayment answers with the ticket, not the payment, so the row it
      // just wrote is read back for its id — it has to be on the rollback list
      // or undoing the import would leave the money banked.
      const written = await prisma.ticketPayment.findFirst({
        where: { agencyId: run.agencyId, ticketId: ticket.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (written) {
        run.recorded.push({
          entity: "ticketPayment",
          entityId: written.id,
          sourceTab: table.tab,
          sourceRow: row.number,
        });
      }

      tally(run.counts, "ticketPayments");
      tally(run.totals, "ticketPayments", payment.amount);
    }

    // The sheet's own word for the state, and only where it differs from what
    // the ticket already is: a blank status and "Pending" both mean a ticket
    // that was issued and is still live.
    const sheetStatus = TICKET_STATUS_MAP[normalise(textOf(table, row, "status") ?? "")];
    if (sheetStatus && sheetStatus !== TicketStatus.ISSUED) {
      await TicketService.changeTicketStatus(
        run.agencyId,
        ticket.id,
        {
          status: sheetStatus,
          // A refund needs a figure and these sheets do not record one, so a
          // row that says "refunded" is taken as refunded in full.
          refundAmount: sheetStatus === TicketStatus.REFUNDED ? fare + changeFee : undefined,
          note: "As the agency's spreadsheet recorded it",
        },
        run.user,
      );
      tally(run.counts, "statusChanges");
    }
  }
};

/** Money collected against a customer's overall balance. */
const importCollections = async (run: Run, table: Table) => {
  const existing = await prisma.dueReceived.findMany({
    where: { agencyId: run.agencyId },
    select: { customerId: true, date: true, amount1: true, cashAccount1Id: true },
  });
  const seen = new Set(
    existing.map(
      (one) =>
        `${one.customerId}|${dayKey(one.date)}|${moneyKey(Number(one.amount1))}|${one.cashAccount1Id}`,
    ),
  );

  let read = 0;

  for (const row of table.rows) {
    run.report("Customer collections", (read += 1), table.rows.length);
    const date = dateOf(table, row, "date");
    const name = textOf(table, row, "customerName");
    const amount = moneyOf(table, row, "amount");
    if (!date || !name || amount === null || amount <= 0) continue;

    const customerId = run.books.customer(textOf(table, row, "customerPhone"), name);
    if (!customerId) {
      flag(run, table.tab, row.number, "customer", `No customer matches "${name}"`);
      continue;
    }

    const accountName = textOf(table, row, "intoAccount");
    const cashAccount1Id = run.books.account(accountName);
    if (!cashAccount1Id) {
      flag(run, table.tab, row.number, "account", `No account named "${accountName ?? "—"}"`);
      continue;
    }

    const key = `${customerId}|${dayKey(date)}|${moneyKey(amount)}|${cashAccount1Id}`;
    if (seen.has(key)) {
      tally(run.skipped, "collections");
      continue;
    }

    const { receipt } = await DueReceivedService.createDueReceived(
      run.agencyId,
      {
        customerId,
        cashAccount1Id,
        amount1: amount,
        date: date.toISOString(),
        notes: textOf(table, row, "note") ?? undefined,
      },
      run.user,
    );

    seen.add(key);
    tally(run.counts, "collections");
    tally(run.totals, "collections", amount);
    run.recorded.push({
      entity: "dueReceived",
      entityId: receipt.id,
      sourceTab: table.tab,
      sourceRow: row.number,
    });
  }
};

/** What was paid out to the agencies the tickets were bought from. */
const importSupplierPayments = async (run: Run, table: Table) => {
  const existing = await prisma.supplierTransaction.findMany({
    where: { agencyId: run.agencyId },
    select: { supplierId: true, date: true, amount: true, cashAccountId: true },
  });
  const seen = new Set(
    existing.map(
      (one) =>
        `${one.supplierId}|${dayKey(one.date)}|${moneyKey(Number(one.amount))}|${one.cashAccountId}`,
    ),
  );

  let read = 0;

  for (const row of table.rows) {
    run.report("Supplier payments", (read += 1), table.rows.length);
    const date = dateOf(table, row, "date");
    const name = textOf(table, row, "supplierName");
    const amount = moneyOf(table, row, "amount");
    if (!date || !name || amount === null || amount <= 0) continue;

    const supplierId = run.books.supplier(name);
    if (!supplierId) {
      flag(run, table.tab, row.number, "supplier", `No supplier named "${name}"`);
      continue;
    }

    const accountName = textOf(table, row, "fromAccount");
    const cashAccountId = run.books.account(accountName);
    if (!cashAccountId) {
      flag(run, table.tab, row.number, "account", `No account named "${accountName ?? "—"}"`);
      continue;
    }

    const key = `${supplierId}|${dayKey(date)}|${moneyKey(amount)}|${cashAccountId}`;
    if (seen.has(key)) {
      tally(run.skipped, "supplierPayments");
      continue;
    }

    const { transaction } = await SupplierTransactionService.createSupplierTransaction(
      run.agencyId,
      {
        supplierId,
        cashAccountId,
        amount,
        date: date.toISOString(),
        note: textOf(table, row, "note") ?? undefined,
      },
      run.user,
    );

    seen.add(key);
    tally(run.counts, "supplierPayments");
    tally(run.totals, "supplierPayments", amount);
    run.recorded.push({
      entity: "supplierTransaction",
      entityId: transaction.id,
      sourceTab: table.tab,
      sourceRow: row.number,
    });
  }
};

const importExpenses = async (run: Run, table: Table) => {
  const existing = await prisma.expense.findMany({
    where: { agencyId: run.agencyId },
    select: { categoryId: true, date: true, amount: true, cashAccountId: true },
  });
  const seen = new Set(
    existing.map(
      (one) =>
        `${one.categoryId}|${dayKey(one.date)}|${moneyKey(Number(one.amount))}|${one.cashAccountId}`,
    ),
  );

  let read = 0;

  for (const row of table.rows) {
    run.report("Expenses", (read += 1), table.rows.length);
    const date = dateOf(table, row, "date");
    const categoryName = textOf(table, row, "category");
    const amount = moneyOf(table, row, "amount");
    if (!date || !categoryName || amount === null || amount <= 0) continue;

    const accountName = textOf(table, row, "fromAccount");
    const cashAccountId = run.books.account(accountName);
    if (!cashAccountId) {
      flag(run, table.tab, row.number, "account", `No account named "${accountName ?? "—"}"`);
      continue;
    }

    // A category invented on a single row still has to exist for that row to
    // import, and the lists step only saw the categories present when it ran.
    let categoryId = run.books.category(categoryName);
    if (!categoryId) {
      const made = await ExpenseService.createCategory(run.agencyId, { name: categoryName });
      categoryId = made.id;
      run.books.addCategory(categoryName, made.id);
      tally(run.counts, "expenseCategories");
      run.recorded.push({
        entity: "expenseCategory",
        entityId: made.id,
        sourceTab: table.tab,
        sourceRow: row.number,
      });
    }

    const key = `${categoryId}|${dayKey(date)}|${moneyKey(amount)}|${cashAccountId}`;
    if (seen.has(key)) {
      tally(run.skipped, "expenses");
      continue;
    }

    const expense = await ExpenseService.createExpense(
      run.agencyId,
      {
        categoryId,
        cashAccountId,
        amount,
        date: date.toISOString(),
        notes: textOf(table, row, "note") ?? undefined,
      },
      run.user,
    );

    seen.add(key);
    tally(run.counts, "expenses");
    tally(run.totals, "expenses", amount);
    run.recorded.push({
      entity: "expense",
      entityId: expense.id,
      sourceTab: table.tab,
      sourceRow: row.number,
    });
  }
};

/**
 * What the owners put in and took back out.
 *
 * The tab puts money in and money out in two columns side by side, and a row
 * fills one of them — so which column carries a figure is what decides the
 * direction, not any word on the row.
 */
const importCapital = async (run: Run, table: Table) => {
  const existing = await prisma.capitalFlow.findMany({
    where: { agencyId: run.agencyId },
    select: { type: true, ownerName: true, date: true, amount: true, cashAccountId: true },
  });
  const seen = new Set(
    existing.map(
      (one) =>
        `${one.type}|${normalise(one.ownerName)}|${dayKey(one.date)}|${moneyKey(Number(one.amount))}|${one.cashAccountId}`,
    ),
  );

  let read = 0;

  for (const row of table.rows) {
    run.report("Owner investment", (read += 1), table.rows.length);
    const date = dateOf(table, row, "date");
    const ownerName = textOf(table, row, "personName");
    const invested = moneyOf(table, row, "investment") ?? 0;
    const withdrawn = moneyOf(table, row, "withdraw") ?? 0;
    if (!date || !ownerName || (invested <= 0 && withdrawn <= 0)) continue;

    const accountName = textOf(table, row, "account");
    const cashAccountId = run.books.account(accountName);
    if (!cashAccountId) {
      flag(run, table.tab, row.number, "account", `No account named "${accountName ?? "—"}"`);
      continue;
    }

    const type = invested > 0 ? CapitalFlowType.INVEST : CapitalFlowType.WITHDRAW;
    const amount = invested > 0 ? invested : withdrawn;

    const key = `${type}|${normalise(ownerName)}|${dayKey(date)}|${moneyKey(amount)}|${cashAccountId}`;
    if (seen.has(key)) {
      tally(run.skipped, "capitalFlows");
      continue;
    }

    const flow = await CapitalService.createCapitalFlow(
      run.agencyId,
      {
        ownerName,
        type,
        amount,
        cashAccountId,
        date: date.toISOString(),
        note: textOf(table, row, "note") ?? undefined,
      },
      run.user,
    );

    seen.add(key);
    tally(run.counts, "capitalFlows");
    tally(run.totals, type === CapitalFlowType.INVEST ? "invested" : "withdrawn", amount);
    run.recorded.push({
      entity: "capitalFlow",
      entityId: flow.id,
      sourceTab: table.tab,
      sourceRow: row.number,
    });
  }
};

/** Profit taken out of the business, which is not the same as capital out. */
const importProfitWithdrawals = async (run: Run, table: Table) => {
  const existing = await prisma.profitWithdrawal.findMany({
    where: { agencyId: run.agencyId },
    select: { receivedBy: true, date: true, amount: true, cashAccountId: true },
  });
  const seen = new Set(
    existing.map(
      (one) =>
        `${normalise(one.receivedBy)}|${dayKey(one.date)}|${moneyKey(Number(one.amount))}|${one.cashAccountId}`,
    ),
  );

  let read = 0;

  for (const row of table.rows) {
    run.report("Profit withdrawals", (read += 1), table.rows.length);
    const date = dateOf(table, row, "date");
    const receivedBy = textOf(table, row, "receivedBy");
    const amount = moneyOf(table, row, "amount");
    if (!date || !receivedBy || amount === null || amount <= 0) continue;

    const accountName = textOf(table, row, "fromAccount");
    const cashAccountId = run.books.account(accountName);
    if (!cashAccountId) {
      flag(run, table.tab, row.number, "account", `No account named "${accountName ?? "—"}"`);
      continue;
    }

    const key = `${normalise(receivedBy)}|${dayKey(date)}|${moneyKey(amount)}|${cashAccountId}`;
    if (seen.has(key)) {
      tally(run.skipped, "profitWithdrawals");
      continue;
    }

    const withdrawal = await CapitalService.createProfitWithdrawal(
      run.agencyId,
      {
        receivedBy,
        amount,
        cashAccountId,
        date: date.toISOString(),
        note: textOf(table, row, "note") ?? undefined,
      },
      run.user,
    );

    seen.add(key);
    tally(run.counts, "profitWithdrawals");
    tally(run.totals, "profitWithdrawn", amount);
    run.recorded.push({
      entity: "profitWithdrawal",
      entityId: withdrawal.id,
      sourceTab: table.tab,
      sourceRow: row.number,
    });
  }
};

/**
 * Reads the workbook and writes the history, in the order the money moved.
 *
 * Capital first, because that is where an agency's money starts; then the sales
 * and what was collected on them; then what went out. The order changes no
 * balance — none of these paths refuse an account that goes negative, on
 * purpose, because a spreadsheet's dates rarely agree with the order things
 * were actually banked in.
 *
 * Not one database transaction, for the same reason as the lists: a few
 * thousand ledger postings held in a single transaction would lock the agency
 * out of its own books for the length of the run. The import record is what
 * makes it reversible instead.
 */
const importHistory = async (
  agencyId: string,
  filename: string,
  file: Buffer,
  user: IRequestUser,
  ctx?: IRunContext,
): Promise<IHistoryResult> => {
  if (!file || file.length === 0) throw new AppError(status.BAD_REQUEST, "The file is empty");

  let sheets: SheetData[];
  try {
    sheets = await readWorkbook(file);
  } catch {
    throw new AppError(
      status.BAD_REQUEST,
      "This file could not be read as a spreadsheet. Export it from Google Sheets as Microsoft Excel (.xlsx) and try again.",
    );
  }

  const accounts = await prisma.cashAccount.count({ where: { agencyId } });
  if (accounts === 0) {
    throw new AppError(
      status.BAD_REQUEST,
      "Bring the lists across first. Every line of the history names an account, a supplier or a customer, and there are none yet.",
    );
  }

  const run: Run = {
    agencyId,
    user,
    books: await loadBooks(agencyId),
    report: ctx?.report ?? (() => {}),
    recorded: [],
    problems: [],
    counts: {},
    skipped: {},
    totals: {},
  };

  const steps: [ImportKind, (run: Run, table: Table) => Promise<void>][] = [
    ["capital", importCapital],
    ["sales", importTickets],
    ["collections", importCollections],
    ["supplierPayments", importSupplierPayments],
    ["expenses", importExpenses],
    ["profitWithdrawals", importProfitWithdrawals],
  ];

  for (const [kind, step] of steps) {
    const table = tableFor(sheets, kind);
    if (!table) continue;
    await step(run, table);
  }

  // The same figure the spreadsheet prints above its sales tab, recomputed
  // from what was actually written, so the two can be put side by side.
  run.totals.profit =
    (run.totals.fare ?? 0) +
    (run.totals.dateChangeFee ?? 0) -
    (run.totals.cost ?? 0) -
    (run.totals.dateChangeCost ?? 0);

  let importId = ctx?.importId;
  if (importId) {
    await ImportRunService.attachRecords(agencyId, importId, run.recorded);
  } else {
    importId = await ImportRunService.recordRun({
      agencyId,
      filename,
      stage: ImportStage.HISTORY,
      counts: run.counts,
      user,
      recorded: run.recorded,
    });
  }

  return {
    importId,
    filename,
    stage: "HISTORY",
    counts: run.counts,
    skipped: run.skipped,
    totals: Object.fromEntries(
      Object.entries(run.totals).map(([key, value]) => [key, Math.round(value * 100) / 100]),
    ),
    problems: run.problems,
  };
};

export const HistoryImportService = { importHistory };
