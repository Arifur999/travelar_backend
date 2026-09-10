import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";
import { env } from "../../config/env.js";
import { Role, UserStatus } from "../../generated/prisma/enums.js";
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
  },

  // Extra columns on User that better-auth must know how to write. agencyId is
  // the tenant key every business query scopes on.
  user: {
    additionalFields: {
      role: { type: "string", required: true, defaultValue: Role.AGENCY_STAFF },
      status: { type: "string", required: true, defaultValue: UserStatus.ACTIVE },
      needPasswordChange: { type: "boolean", required: true, defaultValue: false },
      agencyId: { type: "string", required: false, defaultValue: null },
      isDeleted: { type: "boolean", required: true, defaultValue: false },
      deletedAt: { type: "date", required: false, defaultValue: null },
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
