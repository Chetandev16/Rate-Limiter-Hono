import { Context, Env, Hono } from "hono";
import { todos } from "./data.json";
import { Ratelimit } from "@upstash/ratelimit";
import { BlankInput } from "hono/types";
import { env } from "hono/adapter";
import { Redis } from "@upstash/redis/cloudflare";

declare module "hono" {
  interface ContextVariableMap {
    rateLimit: Ratelimit;
  }
}

const app = new Hono();

const cache = new Map();

class RedisRateLimiter {
  static instance: Ratelimit;

  static getInstance(c: Context<Env, "/todos/:id", BlankInput>) {
    if (!this.instance) {
      const { REDIS_URL, REDIS_TOKEN } = env<{
        REDIS_URL: string;
        REDIS_TOKEN: string;
      }>(c);

      const redisClient = new Redis({
        url: REDIS_URL,
        token: REDIS_TOKEN,
      });

      const rateLimit = new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(2, "10 s"),
        ephemeralCache: cache,
      });

      this.instance = rateLimit;
    }

    return this.instance;
  }
}

app.use(async (c, next) => {
  const rateLimiter = RedisRateLimiter.getInstance(c);
  c.set("rateLimit", rateLimiter);

  await next();
});

app.get("/todos/:id", async (c) => {
  const rateLimit = c.get("rateLimit");
  const ip = c.req.raw.headers.get("CF-Connecting-IP");

  const { success } = await rateLimit.limit(ip ?? "anonymous");

  if (!success) {
    return c.json({ message: "Rate limit exceeded" }, 429);
  }

  const todoId = c.req.param("id");
  const todoIndex = Number(todoId) - 1;

  return c.json({
    todo: todos[todoIndex] || null,
  });
});

export default app;
