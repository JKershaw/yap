import { createChannel, type Channel } from "../channels/channels.ts";
import { createWaiters, type Waiters } from "../listen/listen.ts";
import { createRateLimiter, type RateLimiter } from "../ratelimit/ratelimit.ts";
import type { Config } from "./config.ts";

export type Store = {
  channels: Map<string, Channel>;
  waiters: Waiters;
  rateLimiter: RateLimiter;
  config: Config;
  clock: () => number;
};

export function createStore(config: Config, clock: () => number = Date.now): Store {
  return {
    channels: new Map(),
    waiters: createWaiters(),
    rateLimiter: createRateLimiter(config.rateLimit),
    config,
    clock,
  };
}

export function getOrCreateChannel(
  store: Store,
  name: string,
  password?: string,
): Channel {
  const existing = store.channels.get(name);
  if (existing) return existing;
  const ch = createChannel(name, {
    bufferSize: store.config.bufferSize,
    password,
  });
  store.channels.set(name, ch);
  return ch;
}

export function getChannel(store: Store, name: string): Channel | undefined {
  return store.channels.get(name);
}
