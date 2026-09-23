/**
 * What each tab of an agency's workbook is, and which of our fields its
 * columns feed.
 *
 * The labels below are the ones the spreadsheet these agencies use actually
 * prints, with the variants seen in real copies — a column is found by its
 * label, never by its position, because every agency has added or moved one.
 * A copy that renames a column simply reports that column as unmapped, which
 * the preview shows before anything is written.
 */

export type ImportKind =
  | "sales"
  | "collections"
  | "supplierPayments"
  | "expenses"
  | "masterData"
  | "capital"
  | "accounts";

export interface FieldSpec {
  /** Our field. */
  field: string;
  /** What the sheet might call it. */
  labels: string[];
  /** A row missing this one cannot be imported. */
  required?: boolean;
  type: "text" | "money" | "date" | "number";
}

export interface TabSpec {
  kind: ImportKind;
  /** What the tab is called, loosely — copies add spaces and pluralise. */
  tabNames: string[];
  title: string;
  /** What each row becomes, in the reader's words. */
  creates: string;
  fields: FieldSpec[];
}

export const TAB_SPECS: TabSpec[] = [
  {
    kind: "sales",
    tabNames: ["purchase and sales", "purchase & sales", "sales"],
    title: "Purchase and Sales",
    creates: "one air ticket per row, with the payment taken against it",
    fields: [
      { field: "pnr", labels: ["pnr"], required: true, type: "text" },
      { field: "issueDate", labels: ["issue date"], required: true, type: "date" },
      { field: "airlineCode", labels: ["short code"], type: "text" },
      { field: "airlineName", labels: ["airlines or visa name", "airlines name"], type: "text" },
      { field: "supplierName", labels: ["agency name"], type: "text" },
      { field: "passengerName", labels: ["full name", "passenger"], required: true, type: "text" },
      { field: "customerPhone", labels: ["phone"], type: "text" },
      { field: "passportNo", labels: ["passport number", "passport"], type: "text" },
      { field: "address", labels: ["address"], type: "text" },
      { field: "gender", labels: ["client gender", "gender"], type: "text" },
      { field: "travelDate", labels: ["flight date", "travel date"], type: "date" },
      { field: "route", labels: ["route"], type: "text" },
      { field: "cost", labels: ["buying price", "buying"], required: true, type: "money" },
      { field: "fare", labels: ["selling price", "selling"], required: true, type: "money" },
      { field: "paidAmount", labels: ["payment received amount", "payment received"], type: "money" },
      { field: "paidInto", labels: ["received method", "payment method"], type: "text" },
      { field: "status", labels: ["status"], type: "text" },
      { field: "newTravelDate", labels: ["new date"], type: "date" },
      { field: "dateChangeCost", labels: ["date change fee cost", "change cost"], type: "money" },
      // Not "date change fee": that is the start of "Date Change Fee cost",
      // the supplier side, and both columns would have read the same number.
      { field: "dateChangeFee", labels: ["change customer fee", "customer fee"], type: "money" },
    ],
  },
  {
    kind: "collections",
    tabNames: ["customer transaction"],
    title: "Customer Transaction",
    creates: "one collection per row, against the customer's balance",
    fields: [
      { field: "date", labels: ["date"], required: true, type: "date" },
      { field: "customerName", labels: ["customer"], required: true, type: "text" },
      { field: "customerPhone", labels: ["phone"], type: "text" },
      { field: "amount", labels: ["amount"], required: true, type: "money" },
      { field: "intoAccount", labels: ["to account", "account"], required: true, type: "text" },
      { field: "note", labels: ["details", "note"], type: "text" },
    ],
  },
  {
    kind: "supplierPayments",
    tabNames: ["agency transaction", "supplier transaction"],
    title: "Agency Transaction",
    creates: "one supplier payment per row",
    fields: [
      { field: "date", labels: ["date"], required: true, type: "date" },
      { field: "supplierName", labels: ["agency name", "supplier"], required: true, type: "text" },
      { field: "contactName", labels: ["contact name", "contact"], type: "text" },
      { field: "amount", labels: ["amount"], required: true, type: "money" },
      { field: "fromAccount", labels: ["bank account", "from account", "account"], required: true, type: "text" },
      { field: "note", labels: ["details", "note"], type: "text" },
    ],
  },
  {
    kind: "expenses",
    tabNames: ["expense"],
    title: "Expense",
    creates: "one expense per row, against a category and an account",
    fields: [
      { field: "date", labels: ["date"], required: true, type: "date" },
      { field: "fromAccount", labels: ["form account", "from account", "account"], required: true, type: "text" },
      { field: "amount", labels: ["amount"], required: true, type: "money" },
      { field: "category", labels: ["category"], required: true, type: "text" },
      { field: "note", labels: ["details", "note"], type: "text" },
    ],
  },
  {
    kind: "masterData",
    tabNames: ["airlines  visa list", "airlines visa list", "airlines / visa list", "airlines"],
    title: "Airlines / Visa list",
    creates: "the airline list and the suppliers you buy from",
    fields: [
      { field: "airlineCode", labels: ["short code"], type: "text" },
      { field: "airlineName", labels: ["airlines name", "airlines or visa name", "name"], type: "text" },
      { field: "logoUrl", labels: ["logo url", "logo"], type: "text" },
      { field: "supplierName", labels: ["agency name"], type: "text" },
      { field: "contactName", labels: ["contact name"], type: "text" },
      { field: "phone", labels: ["phone"], type: "text" },
      { field: "address", labels: ["address"], type: "text" },
    ],
  },
  {
    kind: "accounts",
    tabNames: ["balance dashboard", "balance overview"],
    title: "Balance Dashboard",
    creates: "your cash and bank accounts, with the balance they start from",
    fields: [
      { field: "accountName", labels: ["bank / person name", "bank name", "account"], required: true, type: "text" },
      { field: "openingBalance", labels: ["previous amount", "opening"], type: "money" },
    ],
  },
  {
    kind: "capital",
    tabNames: ["investwithdraw", "invest withdraw", "profit withdraw"],
    title: "Investment and withdrawals",
    creates: "owner investment in, and money taken out",
    fields: [
      { field: "date", labels: ["date"], required: true, type: "date" },
      { field: "personName", labels: ["name", "received person"], required: true, type: "text" },
      { field: "amount", labels: ["investment", "amount", "withdraw"], required: true, type: "money" },
      { field: "account", labels: ["methode", "method", "form account", "account"], type: "text" },
      { field: "note", labels: ["details", "note"], type: "text" },
    ],
  },
];

/**
 * Tabs that hold no data of their own. They are reports the spreadsheet
 * computes, and this app computes the same things from the rows it imports —
 * importing them would be importing an opinion twice.
 */
export const REPORT_ONLY_TABS = [
  "read me",
  "supplier & customer dashboard",
  "custom dashboard",
  "monthly dashboard",
  "yearly dashboard",
  "cash flow",
  "settings",
];

/**
 * What the sheet calls a ticket's state, and what it is here.
 *
 * Cancelled is kept rather than dropped: a cancelled ticket is part of the
 * history, and its payments still have to be somewhere.
 */
export const TICKET_STATUS_MAP: Record<string, "ISSUED" | "REISSUED" | "REFUNDED" | "VOID"> = {
  delivered: "ISSUED",
  issued: "ISSUED",
  pending: "ISSUED",
  reissued: "REISSUED",
  "date changed": "REISSUED",
  refunded: "REFUNDED",
  refund: "REFUNDED",
  cancelled: "VOID",
  canceled: "VOID",
  void: "VOID",
};
