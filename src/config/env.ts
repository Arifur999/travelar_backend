import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

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
  SUPER_ADMIN_PASSWORD: z.string().min(8, "SUPER_ADMIN_PASSWORD must be at least 8 characters"),

  CRON_SECRET: z.string().default(""),
  SENTRY_DSN: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

// Fail loudly at boot, listing every problem at once. A server that starts with
// a bad secret fails much later, inside a request, with a confusing message.
if (!parsed.success) {
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
