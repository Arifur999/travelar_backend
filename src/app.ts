import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import path from "path";
import qs from "qs";
import { env } from "./config/env.js";
import { prisma } from "./app/lib/prisma.js";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler.js";
import notFound from "./app/middleware/notFound.js";
import { indexRoute } from "./app/routes/index.js";

const app: Application = express();

// `qs` gives us nested query objects, which is what turns ?fare[lt]=100 into
// { fare: { lt: "100" } } for QueryBuilder.parseRangeFilter. Express 5's default
// "simple" parser hands us the literal key "fare[lt]" and every range filter
// silently does nothing.
app.set("query parser", (str: string) => qs.parse(str));

app.set("view engine", "ejs");
app.set("views", path.resolve(process.cwd(), "src/app/templates"));

// Behind a proxy (Render, Vercel, nginx) every request otherwise lands in one
// rate-limit bucket with the proxy's own IP. The Next server is such a hop
// too: logins arrive from it, not from the browser, so it forwards the
// client's address in X-Forwarded-For and this setting makes req.ip read it.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: [env.FRONTEND_URL, env.BETTER_AUTH_URL, "http://localhost:3000", "http://localhost:5050"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// better-auth's own HTTP router (/api/auth/*) is deliberately NOT mounted.
// Every auth flow goes through /api/v1/auth, which calls auth.api.* in-process,
// and the frontend uses none of better-auth's routes. Mounting it exposed:
//  - POST /sign-up/email, which accepted `role` and `agencyId` from an
//    anonymous body — anyone could create a SUPER_ADMIN, or join any agency;
//  - POST /update-user, which let a signed-in user rewrite the same columns;
//  - POST /sign-in/email, a second login that skipped authRateLimiter and the
//    blocked/deleted checks in AuthService.verifyCredentials.
// If a future flow (OAuth callback, password reset) needs one of its routes,
// mount that single path, before express.json() — better-auth reads the raw
// request stream itself.

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api/v1", indexRoute);

app.get("/", async (req: Request, res: Response) => {
  res.status(200).json({ success: true, message: "Travelar API is working" });
});

// For container healthchecks and load balancers. Unlike `/`, this touches the
// database, so a process that is up but cannot reach Postgres reports 503
// instead of receiving traffic it will fail.
app.get("/health", async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ success: true, message: "ok", database: "up" });
  } catch {
    res.status(503).json({ success: false, message: "database unreachable", database: "down" });
  }
});

// notFound first: it is a 2-arg handler that only runs when nothing matched.
// globalErrorHandler is 4-arg, which is the only thing Express treats as an
// error handler, so it must come last.
app.use(notFound);
app.use(globalErrorHandler);

export default app;
