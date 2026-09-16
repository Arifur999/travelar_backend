import cron, { type ScheduledTask } from "node-cron";
import { env } from "../../config/env.js";
import { AgencyLifecycleService } from "../module/agency/agencyLifecycle.service.js";
import { logger } from "../lib/logger.js";

/**
 * In-process scheduled jobs, started by server.ts after the API is listening.
 *
 * Jobs here must be safe to run on several instances at once — the lifecycle
 * job is: expiring is an idempotent update, and each reminder is claimed with a
 * unique insert before it is sent. Set JOBS_ENABLED=false where an external
 * scheduler calls POST /api/v1/internal/jobs/* instead.
 *
 * Tests import the app, not server.ts, so nothing here runs under Vitest.
 */

let tasks: ScheduledTask[] = [];

const runLifecycle = async (trigger: string) => {
  try {
    const summary = await AgencyLifecycleService.runSubscriptionLifecycle();
    // Hourly runs stay quiet unless they did something; the startup run always
    // reports, so a deploy log shows the job is alive.
    if (trigger === "startup" || summary.expired || summary.reminders) {
      logger.info("subscription lifecycle ran", {
        job: "subscription-lifecycle",
        trigger,
        expired: summary.expired,
        reminders: summary.reminders,
        emails: summary.emails,
      });
    }
  } catch (error) {
    // A failed run must not take the API down; the next hour tries again.
    logger.error("subscription lifecycle failed", { job: "subscription-lifecycle", trigger, err: error });
  }
};

export const startScheduledJobs = () => {
  if (!env.JOBS_ENABLED) {
    logger.info("scheduled jobs are off", { reason: "JOBS_ENABLED=false" });
    return;
  }

  // Five past every hour: reminders go out within the hour they fall due, and
  // an expired trial is read-only in the console within the hour too.
  tasks.push(
    cron.schedule("5 * * * *", () => runLifecycle("hourly"), {
      name: "subscription-lifecycle",
      noOverlap: true,
      timezone: "UTC",
    }),
  );

  logger.info("scheduled jobs started", { job: "subscription-lifecycle", schedule: "5 * * * * (UTC)", firstRunInSeconds: 15 });

  // Once shortly after boot, so a restart or deploy never waits up to an hour
  // to catch up. unref() keeps it from holding the process open on shutdown.
  setTimeout(() => void runLifecycle("startup"), 15_000).unref();
};

export const stopScheduledJobs = () => {
  for (const task of tasks) void task.stop();
  tasks = [];
};
