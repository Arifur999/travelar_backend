import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Operator passwords that are written down somewhere public.
 *
 * SUPER_ADMIN is the platform account: it belongs to no agency and manages all
 * of them, so it is the one login on this system that can reach every tenant's
 * books. A value that has been committed to a repository, printed in a readme
 * or copied from an example file is not a password for that account, whoever
 * else is using it.
 */
const PUBLISHED_OPERATOR_PASSWORDS = new Set([
  // Shipped in .env.example until it was replaced with a placeholder.
  "Admin@12345",
  // vitest.config.ts, for a database nobody can reach.
  "Operator@12345",
  "change-me-before-first-boot",
]);

/** Long enough that guessing it is not the way in. */
const MIN_OPERATOR_PASSWORD = 16;

/**
 * Why this operator password cannot be used here, or null when it can.
 *
 * Only enforced in production. A short password on a developer's laptop
 * protects a database on localhost and refusing it would be theatre; the same
 * password on the live platform is every agency's books.
 */
export const operatorPasswordProblem = (
  password: string,
  nodeEnv: string,
): string | null => {
  if (nodeEnv !== "production") return null;

  if (PUBLISHED_OPERATOR_PASSWORDS.has(password)) {
    return "SUPER_ADMIN_PASSWORD is one of the example values that ship with this repository. It manages every agency on the platform, so it has to be a password nobody else has seen.";
  }

  if (password.length < MIN_OPERATOR_PASSWORD) {
    return `SUPER_ADMIN_PASSWORD must be at least ${MIN_OPERATOR_PASSWORD} characters in production. It is the one account that can reach every agency's books. Generate one with: openssl rand -hex 16`;
  }

  return null;
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MIGRATE_DATABASE_URL: z.string().default(""),
  REDIS_URL: z.string().default(""),

  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  BETTER_AUTH_URL: z.string().default("http://localhost:5000"),

  ACCESS_TOKEN_SECRET: z.string().min(16, "ACCESS_TOKEN_SECRET must be at least 16 characters"),
  REFRESH_TOKEN_SECRET: z.string().min(16, "REFRESH_TOKEN_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default("1d"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),

  FRONTEND_URL: z.string().default("http://localhost:3000"),

  TRIAL_DAYS: z.coerce.number().default(7),

  EMAIL_SENDER_SMTP_HOST: z.string().default(""),
  EMAIL_SENDER_SMTP_PORT: z.coerce.number().default(465),
  EMAIL_SENDER_SMTP_USER: z.string().default(""),
  EMAIL_SENDER_SMTP_PASS: z.string().default(""),
  EMAIL_SENDER_SMTP_FROM: z.string().default(""),

  CLOUDINARY_CLOUD_NAME: z.string().default(""),
  CLOUDINARY_API_KEY: z.string().default(""),
  CLOUDINARY_API_SECRET: z.string().default(""),

  SSLCOMMERZ_STORE_ID: z.string().default(""),
  SSLCOMMERZ_STORE_PASSWORD: z.string().default(""),
  SSLCOMMERZ_IS_LIVE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  SUPER_ADMIN_NAME: z.string().default("Super Admin"),
  SUPER_ADMIN_EMAIL: z.email("SUPER_ADMIN_EMAIL must be a valid email"),
  // The production rules are below, in the superRefine: they need NODE_ENV,
  // which is a sibling field rather than something this one can see.
  SUPER_ADMIN_PASSWORD: z.string().min(8, "SUPER_ADMIN_PASSWORD must be at least 8 characters"),

  // Defaults: info in production, debug in development, error in tests.
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).optional(),

  CRON_SECRET: z.string().default(""),
  // In-process hourly jobs. Leave on for a single instance; set "false" where an
  // external scheduler calls /api/v1/internal/jobs/* instead, or on extra
  // instances (the jobs are safe to run twice, but there is no need).
  JOBS_ENABLED: z
    .string()
    .default("true")
    .transform((value) => value !== "false"),
  SENTRY_DSN: z.string().default(""),
});

const envSchemaWithOperatorRules = envSchema.superRefine((value, ctx) => {
  const problem = operatorPasswordProblem(value.SUPER_ADMIN_PASSWORD, value.NODE_ENV);
  if (problem) {
    ctx.addIssue({ code: "custom", path: ["SUPER_ADMIN_PASSWORD"], message: problem });
  }
});

const parsed = envSchemaWithOperatorRules.safeParse(process.env);

// Fail loudly at boot, listing every problem at once. A server that starts with
// a bad secret fails much later, inside a request, with a confusing message.
if (!parsed.success) {
  // console, not the logger: the logger reads this config, and a boot that
  // fails here must still say why.
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  EMAIL_SENDER: {
    SMTP_HOST: raw.EMAIL_SENDER_SMTP_HOST,
    SMTP_PORT: raw.EMAIL_SENDER_SMTP_PORT,
    SMTP_USER: raw.EMAIL_SENDER_SMTP_USER,
    SMTP_PASS: raw.EMAIL_SENDER_SMTP_PASS,
    SMTP_FROM: raw.EMAIL_SENDER_SMTP_FROM,
  },
  SSLCOMMERZ: {
    STORE_ID: raw.SSLCOMMERZ_STORE_ID,
    STORE_PASSWORD: raw.SSLCOMMERZ_STORE_PASSWORD,
    IS_LIVE: raw.SSLCOMMERZ_IS_LIVE,
    API_BASE: raw.SSLCOMMERZ_IS_LIVE
      ? "https://securepay.sslcommerz.com"
      : "https://sandbox.sslcommerz.com",
  },
};
