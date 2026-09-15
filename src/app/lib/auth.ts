import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";
import { env } from "../../config/env.js";
import { Role, UserStatus } from "../../generated/prisma/enums.js";
import { queuePasswordResetEmail, RESET_TOKEN_TTL_SECONDS } from "../utils/passwordResetEmail.js";
import { prisma } from "./prisma.js";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: prismaAdapter(prisma, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    // Agencies are onboarded by a human who needs to start working immediately;
    // email verification is enforced at the product level later, not at signup.
    requireEmailVerification: false,
    minPasswordLength: 8,
    // Password reset, called in-process from POST /api/v1/auth/forgot-password
    // and /reset-password. better-auth owns the token: single use, consumed
    // atomically, rejected once past this lifetime.
    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
    sendResetPassword: async ({ user, token }) => queuePasswordResetEmail(user, token),
    // Whoever had the old password is signed out everywhere.
    revokeSessionsOnPasswordReset: true,
    // The user chose this password themselves, so a temporary one set by an
    // admin no longer needs replacing.
    onPasswordReset: async ({ user }) => {
      await prisma.user.update({ where: { id: user.id }, data: { needPasswordChange: false } });
    },
  },

  // Extra columns on User that better-auth must know how to write. agencyId is
  // the tenant key every business query scopes on.
  //
  // Every one is `input: false`. Left at better-auth's default they are
  // client-writable: sign-up took `role: "SUPER_ADMIN"` from an anonymous body
  // and update-user let a user move themselves into another agency. With input
  // off, better-auth writes the default on create and rejects the field on
  // update — so the services set these with Prisma after signUpEmail, which is
  // the only place a role or tenant is ever decided.
  user: {
    additionalFields: {
      role: { type: "string", required: true, defaultValue: Role.AGENCY_STAFF, input: false },
      status: { type: "string", required: true, defaultValue: UserStatus.ACTIVE, input: false },
      needPasswordChange: { type: "boolean", required: true, defaultValue: false, input: false },
      agencyId: { type: "string", required: false, defaultValue: null, input: false },
      isDeleted: { type: "boolean", required: true, defaultValue: false, input: false },
      deletedAt: { type: "date", required: false, defaultValue: null, input: false },
    },
  },

  plugins: [bearer()],

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 60 * 24 },
  },

  trustedOrigins: [env.BETTER_AUTH_URL, env.FRONTEND_URL],

  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    cookies: {
      sessionToken: {
        attributes: {
          sameSite: env.NODE_ENV === "production" ? "none" : "lax",
          secure: env.NODE_ENV === "production",
          httpOnly: true,
        },
      },
    },
  },
});
