import { UserStatus } from "../../generated/prisma/enums.js";
import { env } from "../../config/env.js";
import { prisma } from "../lib/prisma.js";
import { sendEmail } from "./email.js";
import { logger } from "../lib/logger.js";

/** How long a reset link lives. better-auth enforces it when the token is used. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * better-auth's sendResetPassword hook. It receives the token for a user that
 * exists; this decides whether an email actually goes out, and builds a link
 * to the web app — better-auth's own URL points at its HTTP router, which is
 * deliberately not mounted.
 *
 * It returns before the email is sent. The request answers the same way
 * whether or not the address has an account, and awaiting SMTP only for the
 * addresses that do would let response time give the answer away.
 */
export const queuePasswordResetEmail = (user: { id: string; email: string; name: string }, token: string) => {
  void (async () => {
    // Blocked or removed accounts get nothing: a new password would not let
    // them in, and a deleted account's inbox may no longer be theirs. The
    // response the caller sees is unchanged.
    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true, isDeleted: true },
    });
    if (!account || account.isDeleted || account.status !== UserStatus.ACTIVE) return;

    const resetUrl = `${env.FRONTEND_URL.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
    const expiresInMinutes = Math.round(RESET_TOKEN_TTL_SECONDS / 60);

    await sendEmail({
      to: user.email,
      subject: "Reset your Travelar password",
      templateName: "reset-password",
      templateData: { name: user.name, email: user.email, resetUrl, expiresInMinutes },
      text: [
        `Hi ${user.name},`,
        "",
        `Someone asked to reset the password for your Travelar account (${user.email}).`,
        "If it was you, choose a new password here:",
        resetUrl,
        "",
        `The link works once and expires in ${expiresInMinutes} minutes. Resetting signs you out everywhere.`,
        "If you did not ask for this, ignore this email.",
      ].join("\n"),
    });
  })().catch((error) => logger.error("password reset email failed", { userId: user.id, err: error }));
};
