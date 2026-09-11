import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Application, Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import path from "path";
import qs from "qs";
import { env } from "./config/env.js";
import { auth } from "./app/lib/auth.js";
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
// rate-limit bucket with the proxy's own IP.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: [env.FRONTEND_URL, env.BETTER_AUTH_URL, "http://localhost:3000", "http://localhost:5050"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// better-auth reads the unconsumed request stream itself, so it must be
// mounted before express.json().
app.use("/api/auth", toNodeHandler(auth));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api/v1", indexRoute);

app.get("/", async (req: Request, res: Response) => {
  res.status(200).json({ success: true, message: "Travelar API is working" });
});

// notFound first: it is a 2-arg handler that only runs when nothing matched.
// globalErrorHandler is 4-arg, which is the only thing Express treats as an
// error handler, so it must come last.
app.use(notFound);
app.use(globalErrorHandler);

export default app;
