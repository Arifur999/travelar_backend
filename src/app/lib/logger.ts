import { env } from "../../config/env.js";

/**
 * One channel for everything the API says.
 *
 * Production writes one JSON object per line, which is what log shippers and
 * `docker logs | jq` expect; development writes a short human line. Tests are
 * silent unless something is actually wrong.
 *
 * Deliberately tiny and dependency-free: the API needs levels, structure and a
 * request id, not a logging framework.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const defaultLevel = (): LogLevel => {
  if (env.LOG_LEVEL) return env.LOG_LEVEL;
  if (env.NODE_ENV === "test") return "error";
  return env.NODE_ENV === "production" ? "info" : "debug";
};

let level: LogLevel = defaultLevel();

export type LogFields = Record<string, unknown>;

/** Where lines go. Swapped in tests to read what was logged. */
export type LogWriter = (line: string, entry: LogFields & { level: LogLevel; msg: string }) => void;

let writer: LogWriter = (line, entry) => {
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
};

/** Test hook: returns a function that restores the previous writer. */
export const setLogWriter = (next: LogWriter) => {
  const previous = writer;
  writer = next;
  return () => {
    writer = previous;
  };
};

export const setLogLevel = (next: LogLevel) => {
  level = next;
};

/** An Error is unwrapped to name/message/stack; anything else is stringified. */
const describeError = (error: unknown) =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { message: String(error) };

const write = (entryLevel: LogLevel, msg: string, fields: LogFields = {}) => {
  if (LEVELS[entryLevel] < LEVELS[level]) return;

  const { err, ...rest } = fields;
  const entry = {
    level: entryLevel,
    time: new Date().toISOString(),
    msg,
    ...rest,
    ...(err === undefined ? {} : { err: describeError(err) }),
  };

  if (env.NODE_ENV === "production") {
    writer(JSON.stringify(entry), entry);
    return;
  }

  // Development: the message first, then the fields that carry meaning.
  const detail = Object.entries(rest)
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" ");
  const error = entry.err ? `\n${(entry.err as { stack?: string }).stack ?? (entry.err as { message: string }).message}` : "";
  writer(`${entryLevel.toUpperCase().padEnd(5)} ${msg}${detail ? ` ${detail}` : ""}${error}`, entry);
};

export const logger = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
