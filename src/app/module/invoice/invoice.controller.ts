import { Request, Response } from "express";
import { requireAgencyId } from "../../middleware/tenantGuards.js";
import catchAsync from "../../shared/catchAsync.js";
import { InvoiceKind, InvoiceService } from "./invoice.service.js";

/**
 * The one place in the API that answers with bytes rather than the JSON
 * envelope, so it writes the response itself instead of using sendResponse.
 * Errors before the PDF exists (404, 403) still go through catchAsync and come
 * back as the usual JSON.
 */
const sendInvoice = (kind: InvoiceKind) =>
  catchAsync(async (req: Request, res: Response) => {
    const { pdf, filename } = await InvoiceService.generateInvoice(kind, requireAgencyId(req), req.params.id as string);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdf.length);
    // inline: opens in the browser's viewer, where it can be printed or saved.
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    // A balance changes the moment a payment is recorded; never serve a stale one.
    res.setHeader("Cache-Control", "private, no-store");
    res.end(pdf);
  });

export const InvoiceController = {
  getTicketInvoice: sendInvoice("ticket"),
  getVisaInvoice: sendInvoice("visa"),
  getHajjInvoice: sendInvoice("hajj"),
  getTourInvoice: sendInvoice("tour"),
};
