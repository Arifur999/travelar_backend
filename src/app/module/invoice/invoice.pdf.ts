import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as fontkit from "fontkit";
import PDFDocument from "pdfkit";
import { IInvoiceDocument } from "./invoice.interface.js";

/* -------------------------------------------------------------------------- *
 * Fonts
 *
 * PDFKit's built-in fonts are WinAnsi only: they cannot draw the Taka sign or
 * a Bangla customer name. Noto Sans is embedded instead, from the Fontsource
 * packages (OFL-1.1). Fontsource splits each family by Unicode range — the
 * Bengali file has no Latin glyphs, not even a space, and the Latin file has
 * no Bengali — so every string is cut into runs, each drawn in a font that
 * actually has its glyphs. fontkit shapes Bengali conjuncts and reorders vowel
 * signs itself.
 *
 * The font for each character is chosen by asking the font (fontkit's
 * hasGlyphForCodePoint), not by hard-coded Unicode ranges: the subsets'
 * advertised ranges are not what they contain — the Latin file lists U+2191
 * but has no glyph for it, and has no → at all, which printed "DAC → JED" as
 * "DAC ▯ JED".
 * -------------------------------------------------------------------------- */

const require = createRequire(import.meta.url);
const fontFile = (pkg: string, file: string) => readFileSync(require.resolve(`${pkg}/files/${file}`));

// Tried in this order for each character.
const FAMILY = ["latin", "latinExt", "bengali"] as const;
type Family = (typeof FAMILY)[number];

// Read once per process; PDFKit parses them per document from these buffers.
const FONTS: Record<Family | `${Family}Bold`, Buffer> = {
  latin: fontFile("@fontsource/noto-sans", "noto-sans-latin-400-normal.woff"),
  latinBold: fontFile("@fontsource/noto-sans", "noto-sans-latin-700-normal.woff"),
  latinExt: fontFile("@fontsource/noto-sans", "noto-sans-latin-ext-400-normal.woff"),
  latinExtBold: fontFile("@fontsource/noto-sans", "noto-sans-latin-ext-700-normal.woff"),
  bengali: fontFile("@fontsource/noto-sans-bengali", "noto-sans-bengali-bengali-400-normal.woff"),
  bengaliBold: fontFile("@fontsource/noto-sans-bengali", "noto-sans-bengali-bengali-700-normal.woff"),
};

// Regular and bold of a subset cover the same characters, so regular answers for both.
const COVERAGE: Record<Family, fontkit.Font> = {
  latin: fontkit.create(FONTS.latin) as fontkit.Font,
  latinExt: fontkit.create(FONTS.latinExt) as fontkit.Font,
  bengali: fontkit.create(FONTS.bengali) as fontkit.Font,
};

/** What to print when no embedded font has a glyph, instead of an empty box. */
const SUBSTITUTES: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "⇒": "=>",
  "✓": "v",
  "✔": "v",
  "•": "·",
};

const ZERO_WIDTH_JOINERS = new Set([0x200c, 0x200d]);
const COMBINING_MARK = /\p{M}/u;

const toRuns = (text: string) => {
  const runs: { family: Family; text: string }[] = [];

  const push = (family: Family, value: string) => {
    const last = runs[runs.length - 1];
    if (last && last.family === family) last.text += value;
    else runs.push({ family, text: value });
  };

  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    const last = runs[runs.length - 1];

    // Joiners and combining marks shape against the letter before them, so
    // they stay in that letter's run whenever its font can draw them — a
    // Latin-font ZWJ in the middle of a Bengali word breaks the conjunct.
    if (
      last &&
      (ZERO_WIDTH_JOINERS.has(codePoint) || COMBINING_MARK.test(char)) &&
      COVERAGE[last.family].hasGlyphForCodePoint(codePoint)
    ) {
      last.text += char;
      continue;
    }

    const family = FAMILY.find((name) => COVERAGE[name].hasGlyphForCodePoint(codePoint));
    if (family) {
      push(family, char);
      continue;
    }

    // Nothing has it. Unusual whitespace prints as a plain space; anything else
    // gets a readable stand-in, or "?" — never an empty box.
    push("latin", SUBSTITUTES[char] ?? (/\s/u.test(char) ? " " : "?"));
  }

  return runs;
};

/* ------------------------------ formatting -------------------------------- */

const MONEY = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
// A real minus sign, not a hyphen, so a reduction reads as one.
const money = (amount: number) => MONEY.format(amount).replace(/^-/, "−");

// Agencies and their customers are in Bangladesh; the server usually runs in
// UTC. Formatting in Dhaka time keeps a payment taken at 1 am on the right day.
const DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Dhaka",
});
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" });

export const formatInvoiceDate = (date: Date) => {
  const parts = Object.fromEntries(DATE_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day} ${parts.month} ${parts.year}`;
};
const formatDateTime = (date: Date) => `${formatInvoiceDate(date)}, ${TIME.format(date)}`;

/* ------------------------------- drawing ---------------------------------- */

const PAGE = { width: 595.28, height: 841.89, margin: 48 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const FOOTER_HEIGHT = 40;
const COLOR = { text: "#111827", muted: "#6b7280", rule: "#e5e7eb", band: "#f3f4f6", accent: "#2563eb" };

interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: string;
  width?: number;
  align?: "left" | "right";
}

class InvoiceWriter {
  readonly doc: PDFKit.PDFDocument;
  y = PAGE.margin;

  constructor(title: string, author: string) {
    this.doc = new PDFDocument({
      size: "A4",
      margin: PAGE.margin,
      bufferPages: true,
      info: { Title: title, Author: author, Creator: "Travelar" },
    });
    for (const [name, data] of Object.entries(FONTS)) this.doc.registerFont(name, data);
  }

  private fontFor(family: Family, bold: boolean) {
    return bold ? `${family}Bold` : family;
  }

  /** Width of a mixed-script string at a size, measured run by run. */
  measure(text: string, size: number, bold = false) {
    return toRuns(text).reduce((sum, run) => {
      this.doc.font(this.fontFor(run.family, bold)).fontSize(size);
      return sum + this.doc.widthOfString(run.text);
    }, 0);
  }

  /**
   * One line of text at (x, y). Too long for `width` → cut with an ellipsis,
   * so a long description can never push a table column out of place.
   */
  line(text: string, x: number, y: number, options: TextOptions = {}) {
    const { size = 10, bold = false, color = COLOR.text, width, align = "left" } = options;

    let value = text;
    if (width !== undefined && this.measure(value, size, bold) > width) {
      const chars = Array.from(value);
      while (chars.length > 0 && this.measure(`${chars.join("")}…`, size, bold) > width) chars.pop();
      value = `${chars.join("")}…`;
    }

    const total = this.measure(value, size, bold);
    let cursor = align === "right" && width !== undefined ? x + width - total : x;

    this.doc.fillColor(color);
    for (const run of toRuns(value)) {
      this.doc.font(this.fontFor(run.family, bold)).fontSize(size);
      this.doc.text(run.text, cursor, y, { lineBreak: false });
      cursor += this.doc.widthOfString(run.text);
    }
  }

  /** Splits text into lines that fit `width`, breaking at spaces. */
  wrap(text: string, width: number, size: number, bold = false) {
    const lines: string[] = [];
    for (const hardLine of text.split("\n")) {
      let current = "";
      for (const word of hardLine.split(" ")) {
        const candidate = current ? `${current} ${word}` : word;
        if (current && this.measure(candidate, size, bold) > width) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  static lineHeight(size: number) {
    return size * 1.45;
  }

  /** Word-wrapped text; returns the height it used. */
  paragraph(text: string, x: number, y: number, width: number, options: TextOptions = {}) {
    const size = options.size ?? 10;
    const lines = this.wrap(text, width, size, options.bold);
    lines.forEach((value, index) =>
      this.line(value, x, y + index * InvoiceWriter.lineHeight(size), { ...options, width }),
    );
    return lines.length * InvoiceWriter.lineHeight(size);
  }

  rule(y: number, color = COLOR.rule) {
    this.doc.moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).lineWidth(0.75).strokeColor(color).stroke();
  }

  /** Starts a new page when `height` more would run into the footer. */
  ensureSpace(height: number) {
    if (this.y + height > PAGE.height - PAGE.margin - FOOTER_HEIGHT) {
      this.doc.addPage();
      this.y = PAGE.margin;
      return true;
    }
    return false;
  }
}

/* ------------------------------- sections --------------------------------- */

const drawHeader = (w: InvoiceWriter, invoice: IInvoiceDocument) => {
  const left = PAGE.margin;
  const rightWidth = 200;
  const right = PAGE.width - PAGE.margin - rightWidth;
  const top = w.y;

  // Agency, left.
  // Wrapped, not truncated: this is the letterhead, and a long trading name
  // cut off with an ellipsis looks like a printing fault.
  let leftY = top + w.paragraph(invoice.agency.name, left, top, CONTENT_WIDTH - rightWidth - 16, { size: 17, bold: true }) + 2;
  const contact = [invoice.agency.phone, invoice.agency.email].filter(Boolean).join("  ·  ");
  if (invoice.agency.address) {
    leftY += w.paragraph(invoice.agency.address, left, leftY, CONTENT_WIDTH - rightWidth - 16, {
      size: 9,
      color: COLOR.muted,
    });
  }
  if (contact) {
    w.line(contact, left, leftY, { size: 9, color: COLOR.muted, width: CONTENT_WIDTH - rightWidth - 16 });
    leftY += 13;
  }

  // Invoice identity, right.
  w.line("INVOICE", right, top, { size: 20, bold: true, color: COLOR.accent, width: rightWidth, align: "right" });
  const meta: [string, string][] = [
    ["Invoice no.", invoice.number],
    ["Date", formatInvoiceDate(invoice.issuedAt)],
    ["For", invoice.kind],
    ["Status", invoice.status],
  ];
  let rightY = top + 30;
  for (const [label, value] of meta) {
    w.line(label, right, rightY, { size: 9, color: COLOR.muted, width: 70 });
    w.line(value, right + 70, rightY, { size: 9, bold: true, width: rightWidth - 70, align: "right" });
    rightY += 14;
  }

  w.y = Math.max(leftY, rightY) + 12;
  w.rule(w.y);
  w.y += 16;
};

const drawParties = (w: InvoiceWriter, invoice: IInvoiceDocument) => {
  const columnWidth = (CONTENT_WIDTH - 24) / 2;
  const left = PAGE.margin;
  const right = PAGE.margin + columnWidth + 24;
  const top = w.y;

  // Billed to.
  w.line("BILLED TO", left, top, { size: 8, bold: true, color: COLOR.muted });
  let leftY = top + 14;
  w.line(invoice.customer.name, left, leftY, { size: 11, bold: true, width: columnWidth });
  leftY += 17;
  const customerLines = [
    invoice.customer.phone,
    invoice.customer.email,
    invoice.customer.passportNo ? `Passport ${invoice.customer.passportNo}` : null,
  ].filter((value): value is string => Boolean(value));
  for (const value of customerLines) {
    w.line(value, left, leftY, { size: 9, color: COLOR.muted, width: columnWidth });
    leftY += 13;
  }
  if (invoice.customer.address) {
    leftY += w.paragraph(invoice.customer.address, left, leftY, columnWidth, { size: 9, color: COLOR.muted });
  }

  // Details.
  w.line("DETAILS", right, top, { size: 8, bold: true, color: COLOR.muted });
  let rightY = top + 14;
  for (const detail of invoice.details) {
    if (!detail.value) continue;
    w.line(detail.label, right, rightY, { size: 9, color: COLOR.muted, width: 92 });
    w.line(detail.value, right + 92, rightY, { size: 9, width: columnWidth - 92 });
    rightY += 14;
  }

  w.y = Math.max(leftY, rightY) + 18;
};

const drawCharges = (w: InvoiceWriter, invoice: IInvoiceDocument) => {
  const amountWidth = 120;
  const descriptionWidth = CONTENT_WIDTH - amountWidth - 16;
  const left = PAGE.margin;
  const amountX = PAGE.width - PAGE.margin - amountWidth;

  w.ensureSpace(60);
  w.doc.rect(left, w.y, CONTENT_WIDTH, 22).fill(COLOR.band);
  w.line("Description", left + 8, w.y + 6, { size: 9, bold: true });
  w.line("Amount", amountX, w.y + 6, { size: 9, bold: true, width: amountWidth - 8, align: "right" });
  w.y += 30;

  for (const item of invoice.lines) {
    w.ensureSpace(20);
    w.line(item.description, left + 8, w.y, { size: 10, width: descriptionWidth });
    w.line(money(item.amount), amountX, w.y, { size: 10, width: amountWidth - 8, align: "right" });
    w.y += 20;
  }

  w.rule(w.y - 4);
  w.y += 6;

  // Totals, right-aligned block.
  const labelWidth = 110;
  const blockX = PAGE.width - PAGE.margin - labelWidth - amountWidth;
  const totals: [string, string, boolean][] = [
    ["Total", money(invoice.total), false],
    ["Paid", money(invoice.paid), false],
  ];
  w.ensureSpace(70);
  for (const [label, value] of totals) {
    w.line(label, blockX, w.y, { size: 10, color: COLOR.muted, width: labelWidth });
    w.line(value, blockX + labelWidth, w.y, { size: 10, width: amountWidth - 8, align: "right" });
    w.y += 18;
  }

  const dueLabel = invoice.due > 0.005 ? "Balance due" : invoice.due < -0.005 ? "In credit" : "Paid in full";
  const dueValue = money(Math.abs(invoice.due));
  w.doc.rect(blockX - 8, w.y - 5, labelWidth + amountWidth + 8, 26).fill(COLOR.band);
  w.line(dueLabel, blockX, w.y + 1, { size: 11, bold: true, width: labelWidth });
  w.line(dueValue, blockX + labelWidth, w.y + 1, {
    size: 11,
    bold: true,
    color: invoice.due > 0.005 ? COLOR.text : COLOR.accent,
    width: amountWidth - 8,
    align: "right",
  });
  w.y += 40;
};

const drawPayments = (w: InvoiceWriter, invoice: IInvoiceDocument) => {
  const left = PAGE.margin;
  const columns = [
    { label: "Date", width: 82, align: "left" as const },
    { label: "Method", width: 92, align: "left" as const },
    { label: "Account", width: 120, align: "left" as const },
    { label: "Reference", width: CONTENT_WIDTH - 82 - 92 - 120 - 112, align: "left" as const },
    { label: "Amount", width: 112, align: "right" as const },
  ];

  const drawHead = () => {
    w.line("PAYMENTS", left, w.y, { size: 8, bold: true, color: COLOR.muted });
    w.y += 14;
    let x = left;
    for (const column of columns) {
      w.line(column.label, x + 4, w.y, { size: 9, bold: true, width: column.width - 8, align: column.align });
      x += column.width;
    }
    w.y += 16;
    w.rule(w.y - 4);
  };

  w.ensureSpace(60);
  drawHead();

  if (invoice.payments.length === 0) {
    w.line("No payments recorded yet.", left + 4, w.y + 2, { size: 9, color: COLOR.muted });
    w.y += 24;
    return;
  }

  for (const payment of invoice.payments) {
    if (w.ensureSpace(18)) drawHead();
    const cells = [
      formatInvoiceDate(payment.date),
      payment.method,
      payment.account,
      payment.reference ?? "—",
      money(payment.amount),
    ];
    let x = left;
    cells.forEach((cell, index) => {
      const column = columns[index]!;
      w.line(cell, x + 4, w.y, { size: 9, width: column.width - 8, align: column.align });
      x += column.width;
    });
    w.y += 18;
  }
  w.y += 8;
};

const drawNote = (w: InvoiceWriter, note: string) => {
  const width = CONTENT_WIDTH - 24;
  const height = w.wrap(note, width, 9).length * InvoiceWriter.lineHeight(9) + 20;
  w.ensureSpace(height);
  w.doc.rect(PAGE.margin, w.y, CONTENT_WIDTH, height).fill(COLOR.band);
  w.paragraph(note, PAGE.margin + 12, w.y + 10, width, { size: 9 });
  w.y += height + 12;
};

const drawFooters = (w: InvoiceWriter, invoice: IInvoiceDocument, generatedAt: Date) => {
  const range = w.doc.bufferedPageRange();
  for (let index = 0; index < range.count; index++) {
    w.doc.switchToPage(range.start + index);
    const y = PAGE.height - PAGE.margin - 14;
    w.rule(y - 8);
    w.line(
      `${invoice.number} · Generated by Travelar on ${formatDateTime(generatedAt)} · Computer-generated, no signature required.`,
      PAGE.margin,
      y,
      { size: 7.5, color: COLOR.muted, width: CONTENT_WIDTH - 60 },
    );
    w.line(`Page ${index + 1} of ${range.count}`, PAGE.margin, y, {
      size: 7.5,
      color: COLOR.muted,
      width: CONTENT_WIDTH,
      align: "right",
    });
  }
};

/** Renders the invoice to a PDF in memory. */
export const renderInvoicePdf = (invoice: IInvoiceDocument, generatedAt = new Date()): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const writer = new InvoiceWriter(`Invoice ${invoice.number}`, invoice.agency.name);
    const chunks: Buffer[] = [];

    writer.doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    writer.doc.on("end", () => resolve(Buffer.concat(chunks)));
    writer.doc.on("error", reject);

    try {
      drawHeader(writer, invoice);
      drawParties(writer, invoice);
      drawCharges(writer, invoice);
      drawPayments(writer, invoice);
      if (invoice.note) drawNote(writer, invoice.note);
      drawFooters(writer, invoice, generatedAt);
      writer.doc.end();
    } catch (error) {
      reject(error);
    }
  });
