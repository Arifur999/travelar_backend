import ejs from "ejs";
import nodemailer, { type Transporter } from "nodemailer";
import path from "path";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";
import { env } from "../../config/env.js";
import { logger } from "../lib/logger.js";

export interface IOutboundEmail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Every message sent while NODE_ENV is "test". The integration suite reads it
 * to follow a link it was emailed; nothing else ever does.
 */
export const testOutbox: IOutboundEmail[] = [];

/**
 * Where mail goes, decided once:
 *  - test: captured in `testOutbox`, never sent.
 *  - no SMTP_HOST (typical local dev): not sent; the subject and text body
 *    are printed, so a developer can follow a reset link without a mail server.
 *  - otherwise: SMTP. Port 465 is implicit TLS; anything else upgrades with
 *    STARTTLS, which is what `secure: true` on every port used to get wrong.
 */
let transporter: Transporter | null = null;
const getTransporter = () => {
  if (!transporter) {
    transporter =
      env.NODE_ENV === "test" || !env.EMAIL_SENDER.SMTP_HOST
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport({
            host: env.EMAIL_SENDER.SMTP_HOST,
            port: Number(env.EMAIL_SENDER.SMTP_PORT),
            secure: Number(env.EMAIL_SENDER.SMTP_PORT) === 465,
            auth: { user: env.EMAIL_SENDER.SMTP_USER, pass: env.EMAIL_SENDER.SMTP_PASS },
          });
  }
  return transporter;
};

interface ISendEmail {
  to: string;
  subject: string;
  templateName: string;
  templateData?: Record<string, unknown>;
  /** Plain-text alternative, for clients that do not render HTML. */
  text?: string;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
}

export const sendEmail = async ({ to, subject, templateName, templateData, text, attachments }: ISendEmail) => {
  try {
    // Templates resolve from disk at process.cwd(), which is why a serverless
    // deploy must bundle src/app/templates/**.
    const templatePath = path.resolve(process.cwd(), `src/app/templates/${templateName}.ejs`);
    const html = await ejs.renderFile(templatePath, templateData ?? {});

    if (env.NODE_ENV === "test") {
      testOutbox.push({ to, subject, html, text });
      return;
    }

    const info = await getTransporter().sendMail({
      from: env.EMAIL_SENDER.SMTP_FROM || "Travelar <no-reply@travelar.local>",
      to,
      subject,
      html,
      text,
      attachments,
    });

    if (!env.EMAIL_SENDER.SMTP_HOST) {
      logger.warn("email not sent: SMTP_HOST is unset", { to, subject, body: text ?? "(html only)" });
      return;
    }

    logger.info("email sent", { to, subject, messageId: info.messageId });
  } catch (error) {
    logger.error("email failed", { to, subject, err: error });
    throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to send email");
  }
};
