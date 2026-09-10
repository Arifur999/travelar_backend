import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 does not load .env into the config file itself, so `prisma migrate`
// sees an undefined datasource url unless we load it here explicitly.
dotenv.config();

export default defineConfig({
  schema: "prisma/schema",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] },
});
