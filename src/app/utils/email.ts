import ejs from "ejs";
import nodemailer from "nodemailer";
import path from "path";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";
import { env } from "../../config/env.js";

const transporter = nodemailer.createTransport({
  host: env.EMAIL_SENDER.SMTP_HOST,
  port: Number(env.EMAIL_SENDER.SMTP_PORT),
  secure: true,
  auth: { user: env.EMAIL_SENDER.SMTP_USER, pass: env.EMAIL_SENDER.SMTP_PASS },
});

interface ISendEmail {
  to: string;
  subject: string;
  templateName: string;
  templateData?: Record<string, unknown>;
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[];
}

export const sendEmail = async ({ to, subject, templateName, templateData, attachments }: ISendEmail) => {
  try {
    // Templates resolve from disk at process.cwd(), which is why a serverless
    // deploy must bundle src/app/templates/**.
    const templatePath = path.resolve(process.cwd(), `src/app/templates/${templateName}.ejs`);
    const html = await ejs.renderFile(templatePath, templateData ?? {});

    const info = await transporter.sendMail({
      from: env.EMAIL_SENDER.SMTP_FROM,
      to,
      subject,
      html,
      attachments,
    });

    console.log(`Email sent to ${to} : ${info.messageId}`);
  } catch (error) {
    console.error("Failed to send email:", error);
    throw new AppError(status.INTERNAL_SERVER_ERROR, "Failed to send email");
  }
};
