/**
 * One printable invoice, independent of which module it came from. The three
 * builders in invoice.service.ts fill this in; invoice.pdf.ts only draws it,
 * so the layout never has to know what a PNR or a batch is.
 */
export interface IInvoiceDocument {
  /** "TKT-…", "VIS-…", "HAJ-…" — stable for the same record. */
  number: string;
  /** Shown under the title: "Air ticket", "Visa processing", "Hajj & Umrah". */
  kind: string;
  status: string;
  issuedAt: Date;

  agency: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  };

  customer: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    passportNo?: string | null;
  };

  /** Label/value pairs describing what was sold. Empty values are skipped. */
  details: { label: string; value: string | null | undefined }[];

  /** Charges and reductions; a reduction is a negative amount. Sums to `total`. */
  lines: { description: string; amount: number }[];

  payments: {
    date: Date;
    method: string;
    account: string;
    reference?: string | null;
    amount: number;
  }[];

  total: number;
  paid: number;
  /** total − paid. Negative means the customer is in credit. */
  due: number;

  /** Printed above the footer when something needs saying (e.g. cancelled). */
  note?: string | null;
}
