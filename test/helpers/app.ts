import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "../../src/app/lib/prisma.js";
import { seedSuperAdmin } from "../../src/app/utils/seed.js";
import app from "../../src/app.js";

export interface TestApp {
  api: ApiClient;
  close: () => Promise<void>;
}

/**
 * Empties every table (keeping the migration history), re-seeds the platform
 * operator, and starts the real app on a free port. Call once per test file.
 */
export const startTestApp = async (): Promise<TestApp> => {
  const database = new URL(process.env.DATABASE_URL!).pathname;
  if (!database.endsWith("_test")) {
    throw new Error(`Refusing to reset "${database}" — not a _test database.`);
  }

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  }
  await seedSuperAdmin();

  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    api: new ApiClient(`http://127.0.0.1:${port}`),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.$disconnect();
    },
  };
};

export interface Session {
  accessToken: string;
  refreshToken: string;
  token: string;
  user: { id: string; role: string; agencyId: string | null; email: string; needPasswordChange?: boolean };
}

export interface ApiResult<T = any> {
  status: number;
  body: {
    success: boolean;
    message: string;
    data: T;
    meta?: { page: number; limit: number; total: number; totalPages: number };
    /** Present on error envelopes. */
    requestId?: string;
  };
  headers: Headers;
  raw: Buffer;
}

let ipCounter = 0;
/**
 * A different client address per request unless a test pins one. The API
 * rate-limits logins per address, and a whole suite of logins from 127.0.0.1
 * would otherwise trip it. `trust proxy` makes req.ip read this header.
 */
const nextIp = () => {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

export class ApiClient {
  constructor(readonly baseUrl: string) {}

  async request<T = any>(
    method: string,
    path: string,
    options: { session?: Session; body?: unknown; ip?: string; headers?: Record<string, string> } = {},
  ): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { "X-Forwarded-For": options.ip ?? nextIp(), ...options.headers };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.session) {
      headers.Cookie = `accessToken=${options.session.accessToken}; better-auth.session_token=${options.session.token}`;
    }

    const response = await fetch(`${this.baseUrl}${path.startsWith("/api") || path.startsWith("/health") ? path : `/api/v1${path}`}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const raw = Buffer.from(await response.arrayBuffer());
    let body: ApiResult<T>["body"];
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      body = { success: response.ok, message: "", data: undefined as T };
    }
    return { status: response.status, body, headers: response.headers, raw };
  }

  get<T = any>(path: string, session?: Session) {
    return this.request<T>("GET", path, { session });
  }
  post<T = any>(path: string, body: unknown, session?: Session) {
    return this.request<T>("POST", path, { body, session });
  }
  patch<T = any>(path: string, body: unknown, session?: Session) {
    return this.request<T>("PATCH", path, { body, session });
  }
  delete<T = any>(path: string, session?: Session) {
    return this.request<T>("DELETE", path, { session });
  }

  /** Throws unless the call succeeded, and returns `data` — for arranging state. */
  async ok<T = any>(method: string, path: string, body?: unknown, session?: Session): Promise<T> {
    const result = await this.request<T>(method, path, { body, session });
    if (result.status >= 300) {
      throw new Error(`${method} ${path} -> ${result.status} ${result.body?.message}`);
    }
    return result.body.data;
  }

  async login(email: string, password: string): Promise<Session> {
    return this.ok<Session>("POST", "/auth/login", { email, password });
  }

  loginOperator() {
    return this.login(process.env.SUPER_ADMIN_EMAIL!, process.env.SUPER_ADMIN_PASSWORD!);
  }

  private agencyCount = 0;
  /** A fresh agency on its trial, signed in as its owner. */
  async registerAgency(label = "Agency"): Promise<Session & { email: string; password: string }> {
    this.agencyCount += 1;
    const email = `${label.toLowerCase().replace(/\W+/g, "-")}-${this.agencyCount}-${Date.now()}@example.test`;
    const password = "Owner@12345";
    const session = await this.ok<Session>("POST", "/auth/register", {
      agencyName: `${label} ${this.agencyCount}`,
      name: `${label} Owner`,
      email,
      password,
    });
    return { ...session, email, password };
  }
}
