import { Server } from "http";
import app from "./app.js";
import { env } from "./config/env.js";
import { redisService } from "./app/lib/redis.js";
import { seedSuperAdmin } from "./app/utils/seed.js";
import { initErrorMonitoring } from "./app/lib/sentry.js";

let server: Server;

const bootstrap = async () => {
  try {
    initErrorMonitoring();

    // The platform needs an operator before it can manage any tenant.
    await seedSuperAdmin();

    // Redis is optional — a failure here must not stop the server booting.
    await redisService.connect().catch(console.error);

    server = app.listen(env.PORT, () => {
      console.log(`Server is running on http://localhost:${env.PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

const shutdown = (signal: string, exitCode: number) => {
  console.log(`${signal} received. Shutting down server...`);

  if (!server) {
    process.exit(exitCode);
    return;
  }

  // Exit from inside the callback, otherwise the process dies before in-flight
  // requests drain and the graceful close is decorative.
  server.close(() => {
    console.log("Server closed gracefully.");
    process.exit(exitCode);
  });
};

// A signal is a clean shutdown, so it exits 0. Only a crash exits 1.
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("SIGINT", () => shutdown("SIGINT", 0));

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception detected:", error);
  shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection detected:", reason);
  shutdown("unhandledRejection", 1);
});

bootstrap();
