import { createClient, RedisClientType } from "redis";
import { env } from "../../config/env.js";
import { logger } from "./logger.js";

// Every method here swallows its errors: Redis is a cache and a rate-limit
// counter, never a source of truth, so the API must keep working without it.
class RedisService {
  private client: RedisClientType | null = null;
  private isConnected = false;

  async connect() {
    if (!env.REDIS_URL) {
      logger.info("Redis disabled", { reason: "REDIS_URL not set" });
      return;
    }

    try {
      this.client = createClient({ url: env.REDIS_URL });

      this.client.on("error", (error) => {
        this.isConnected = false;
        logger.error("Redis error", { err: error });
      });
      this.client.on("ready", () => { this.isConnected = true; });
      this.client.on("end", () => { this.isConnected = false; });

      await this.client.connect();
    } catch (error) {
      logger.error("Redis connection failed", { err: error });
    }
  }

  /**
   * Logs a failed call only when Redis was supposed to be there. With REDIS_URL
   * unset every call "fails" by design, and logging each one printed a full
   * stack trace per login attempt. A configured-but-down Redis still gets a
   * one-line message, without the stack.
   */
  private logFailure(action: string, error: unknown) {
    if (!env.REDIS_URL) return;
    logger.warn("Redis command failed", { action, message: error instanceof Error ? error.message : String(error) });
  }

  private ensureConnected(): RedisClientType {
    if (!this.client || !this.isConnected) {
      throw new Error("Redis is not connected");
    }
    return this.client;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const value = await this.ensureConnected().get(key);
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as T;
      }
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, ttlInSeconds?: number): Promise<void> {
    try {
      const payload = typeof value === "string" ? value : JSON.stringify(value);
      const client = this.ensureConnected();
      if (ttlInSeconds) {
        await client.set(key, payload, { EX: ttlInSeconds });
      } else {
        await client.set(key, payload);
      }
    } catch (error) {
      this.logFailure("set", error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.ensureConnected().del(key);
    } catch (error) {
      this.logFailure("delete", error);
    }
  }

  // Atomically increments a counter and, on its first increment, sets the key
  // to expire after ttlInSeconds (a fixed-window rate-limit counter). Returns
  // null if Redis is unavailable so callers can fail OPEN rather than block
  // legitimate traffic.
  async incrementWithExpiry(key: string, ttlInSeconds: number): Promise<number | null> {
    try {
      const client = this.ensureConnected();
      const count = await client.incr(key);
      if (count === 1) {
        await client.expire(key, ttlInSeconds);
      }
      return count;
    } catch (error) {
      this.logFailure("increment", error);
      return null;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureConnected().ping();
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {
      // ignore
    }
  }
}

export const redisService = new RedisService();
