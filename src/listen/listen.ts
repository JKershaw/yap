import type { Message } from "../messages/messages.ts";

export type Predicate = (msg: Message) => boolean;

type Waiter = {
  channel: string;
  predicate: Predicate;
  resolve: (msg: Message | null) => void;
};

export type Waiters = {
  set: Set<Waiter>;
};

export function createWaiters(): Waiters {
  return { set: new Set() };
}

/**
 * Blocks until a message in `channel` matches `predicate`, the timeout
 * elapses, or `signal` aborts. An explicit `setTimeout` (not
 * `AbortSignal.timeout`) keeps the event loop alive until resolution
 * so callers in short-lived scripts still see the timeout fire.
 */
export function waitForMatch(
  waiters: Waiters,
  channel: string,
  predicate: Predicate,
  waitMs: number,
  signal?: AbortSignal,
): Promise<Message | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (msg: Message | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      waiters.set.delete(waiter);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(msg);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), waitMs);
    const waiter: Waiter = {
      channel,
      predicate,
      resolve: (msg) => finish(msg),
    };
    waiters.set.add(waiter);
    if (signal) {
      if (signal.aborted) finish(null);
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Wakes any registered waiter whose predicate matches the new message.
 * Called by the store after each successful message append.
 */
export function notifyWaiters(waiters: Waiters, msg: Message): void {
  for (const waiter of [...waiters.set]) {
    if (waiter.channel === msg.channel && waiter.predicate(msg)) {
      waiter.resolve(msg);
    }
  }
}

export function makePredicate(opts: { mention?: string; keyword?: string }): Predicate {
  const mention = opts.mention;
  const keyword = opts.keyword?.toLowerCase();
  return (msg) => {
    if (mention && !msg.mentions.includes(mention)) return false;
    if (keyword && !msg.text.toLowerCase().includes(keyword)) return false;
    return true;
  };
}
