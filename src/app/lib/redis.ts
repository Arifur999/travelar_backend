import { createClient, RedisClientType } from "redis";
import { env } from "../../config/env.js";

// Every method here swallows its errors: Redis is a cache and a rate-limit
// counter, never a source of truth, so the API must keep working without it.
class RedisService {
  private client: RedisClientType | null = null;
  private isConnected = false;

  async connect() {
    if (!env.REDIS_URL) {
      console.log("REDIS_URL not set — Redis features are disabled.");
      return;
    }

    try {
      this.client = createClient({ url: env.REDIS_URL });

      this.client.on("error", (error) => {
        this.isConnected = false;
        console.error("Redis error:", error);
      });
      this.client.on("ready", () => { this.isConnected = true; });
      this.client.on("end", () => { this.isConnected = false; });

      await this.client.connect();
    } catch (error) {
      console.error("Redis connection failed:", error);
    }
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
      console.error("Error setting Redis key:", error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.ensureConnected().del(key);
    } catch (error) {
      console.error("Error deleting Redis key:", error);
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
      console.error("Error incrementing Redis key:", error);
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
