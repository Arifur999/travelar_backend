import { Server } from "http";
import app from "./app.js";
import { env } from "./config/env.js";
import { redisService } from "./app/lib/redis.js";
import { seedSuperAdmin } from "./app/utils/seed.js";
import { initErrorMonitoring } from "./app/lib/sentry.js";
import { startScheduledJobs, stopScheduledJobs } from "./app/jobs/scheduler.js";
import { logger } from "./app/lib/logger.js";

let server: Server;

const bootstrap = async () => {
  try {
    initErrorMonitoring();

    // The platform needs an operator before it can manage any tenant.
    await seedSuperAdmin();

    // Redis is optional — a failure here must not stop the server booting.
    await redisService.connect().catch((error) => logger.error("Redis connect failed", { err: error }));

    server = app.listen(env.PORT, () => {
      logger.info("server listening", { port: env.PORT, env: env.NODE_ENV });
    });

    startScheduledJobs();
  } catch (error) {
    logger.error("server failed to start", { err: error });
    process.exit(1);
  }
};

const shutdown = (signal: string, exitCode: number) => {
  logger.info("shutting down", { signal });
  stopScheduledJobs();

  if (!server) {
    process.exit(exitCode);
    return;
  }

  // Exit from inside the callback, otherwise the process dies before in-flight
  // requests drain and the graceful close is decorative.
  server.close(() => {
    logger.info("server closed gracefully");
    process.exit(exitCode);
  });
};

// A signal is a clean shutdown, so it exits 0. Only a crash exits 1.
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGINT", () => shutdown("SIGINT", 0));

process.on("uncaughtException", (error) => {
  logger.error("uncaught exception", { err: error });
  shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", { err: reason });
  shutdown("unhandledRejection", 1);
});

bootstrap();
