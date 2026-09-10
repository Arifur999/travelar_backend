import crypto from "node:crypto";
import os from "node:os";
import { env } from "../../config/env.js";

// Dependency-free Sentry reporter: we speak the envelope ingestion API directly
// over fetch so nothing has to be added to the lockfile. Enable by setting
// SENTRY_DSN; with no DSN every function here is a safe no-op.
const dsn = env.SENTRY_DSN;

const parseDsn = (value: string) => {
  try {
    const url = new URL(value);
    const projectId = url.pathname.replace("/", "");
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/?sentry_key=${url.username}&sentry_version=7`,
    };
  } catch {
    return null;
  }
};

const parsedDsn = dsn ? parseDsn(dsn) : null;

export const isErrorMonitoringEnabled = () => Boolean(parsedDsn) && typeof fetch === "function";

const parseStack = (stack?: string) => {
  if (!stack) return [];

  const frames = stack
    .split("\n")
    .map((line) => line.trim().match(/at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/))
    .filter(Boolean)
    .map((match) => ({
      function: match![1] ?? "<anonymous>",
      filename: match![2],
      lineno: Number(match![3]),
      colno: Number(match![4]),
    }));

  // Sentry expects oldest frame first.
  return frames.reverse();
};

export const captureException = (error: unknown, context?: Record<string, unknown>) => {
  // Reporting must never throw and must never block the request.
  try {
    if (!parsedDsn || typeof fetch !== "function") return;

    const err = error instanceof Error ? error : new Error(String(error));
    const eventId = crypto.randomBytes(16).toString("hex");

    const event = {
      event_id: eventId,
      timestamp: new Date().toISOString(),
      platform: "node",
      level: "error",
      logger: "backend",
      environment: env.NODE_ENV,
      server_name: os.hostname(),
      exception: {
        values: [
          {
            type: err.name,
            value: err.message,
            stacktrace: { frames: parseStack(err.stack) },
          },
        ],
      },
      extra: { ...context, stack: err.stack },
    };

    const envelope =
      `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n` +
      `${JSON.stringify({ type: "event" })}\n` +
      `${JSON.stringify(event)}\n`;

    // Fire-and-forget: never let error reporting break the request flow.
    void fetch(parsedDsn.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    }).catch(() => undefined);
  } catch {
    // deliberately swallowed
  }
};

export const initErrorMonitoring = () => {
  if (!isErrorMonitoringEnabled()) return;

  process.on("uncaughtException", (error) => captureException(error, { kind: "uncaughtException" }));
  process.on("unhandledRejection", (reason) => captureException(reason, { kind: "unhandledRejection" }));

  console.log("Error monitoring (Sentry) enabled");
};
