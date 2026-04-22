import {
  getOrCreateChannel,
  getChannel,
  type Store,
} from "../store/store.ts";
import { joinChannel, leaveChannel, touchMember } from "../channels/channels.ts";
import {
  appendMessage,
  messagesSince,
  historyOf,
  type Message,
  type MessageType,
} from "../messages/messages.ts";
import { listActiveMembers, type MemberPresence } from "../presence/presence.ts";
import { allow } from "../ratelimit/ratelimit.ts";
import {
  waitForMatch,
  notifyWaiters,
  makePredicate,
} from "../listen/listen.ts";

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string; status: number };
export type Result<T> = Ok<T> | Err;

const MAX_WAIT_SECONDS = 30;

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
function err(error: string, status = 400): Err {
  return { ok: false, error, status };
}

function validNick(nick: string): boolean {
  return /^[\w-]{1,32}$/.test(nick);
}
function validChannel(name: string): boolean {
  return /^[#&][\w-]{1,64}$/.test(name);
}

export type JoinArgs = {
  channel: string;
  nick: string;
  password?: string;
};

export function joinHandler(
  store: Store,
  args: JoinArgs,
): Result<{ recent: Message[]; cursor: number }> {
  if (!validNick(args.nick)) return err("invalid nick");
  if (!validChannel(args.channel)) return err("invalid channel name");

  const channel = getOrCreateChannel(store, args.channel, args.password);
  const result = joinChannel(channel, args.nick, args.password, store.clock());
  if (!result.ok) return err(result.error, 403);

  const recent = historyOf(channel);
  const cursor = recent.length === 0 ? 0 : recent[recent.length - 1]!.id;
  return ok({ recent, cursor });
}

export type LeaveArgs = { channel: string; nick: string };

export function leaveHandler(store: Store, args: LeaveArgs): Result<{ ok: true }> {
  if (!validNick(args.nick)) return err("invalid nick");
  const channel = getChannel(store, args.channel);
  if (channel) leaveChannel(channel, args.nick);
  return ok({ ok: true });
}

export type SayArgs = {
  channel: string;
  nick: string;
  message: string;
  type?: MessageType;
  password?: string;
};

export function sayHandler(
  store: Store,
  args: SayArgs,
): Result<{ id: number; timestamp: number }> {
  if (!validNick(args.nick)) return err("invalid nick");
  if (!validChannel(args.channel)) return err("invalid channel name");
  const text = args.message?.trim() ?? "";
  if (text === "") return err("empty message");
  if (text.length > 4000) return err("message too long");
  const type: MessageType = args.type ?? "message";
  if (type !== "message" && type !== "action") return err("invalid message type");

  // Only `join` creates channels — say auto-joins an existing channel but
  // won't silently create a gated one on the caller's behalf.
  const existing = getChannel(store, args.channel);
  if (!existing) return err("channel not found; join first", 404);
  const channel = existing;
  if (!channel.members.has(args.nick)) {
    const joined = joinChannel(channel, args.nick, args.password, store.clock());
    if (!joined.ok) return err(joined.error, 403);
  }

  if (!allow(store.rateLimiter, args.nick, store.clock())) {
    return err("rate limit exceeded", 429);
  }

  const msg = appendMessage(channel, args.nick, args.message, type, store.clock);
  touchMember(channel, args.nick, store.clock());
  notifyWaiters(store.waiters, msg);
  return ok({ id: msg.id, timestamp: msg.timestamp });
}

export type PollArgs = {
  channel: string;
  nick: string;
  since_id?: number;
};

export function pollHandler(
  store: Store,
  args: PollArgs,
): Result<{
  messages: Message[];
  mentions: Message[];
  cursor: number;
  truncated: boolean;
}> {
  if (!validNick(args.nick)) return err("invalid nick");
  if (!validChannel(args.channel)) return err("invalid channel name");
  const channel = getChannel(store, args.channel);
  if (!channel) {
    return ok({ messages: [], mentions: [], cursor: args.since_id ?? 0, truncated: false });
  }
  const { messages, cursor, truncated } = messagesSince(channel, args.since_id);
  const mentions = messages.filter((m) => m.mentions.includes(args.nick));
  touchMember(channel, args.nick, store.clock());
  return ok({ messages, mentions, cursor, truncated });
}

export type ListenArgs = {
  channel: string;
  nick: string;
  mention?: string;
  keyword?: string;
  wait?: number;
  since_id?: number;
};

/**
 * Long-polling variant of `poll`. If there's already a matching message
 * in the buffer after `since_id`, returns immediately. Otherwise waits up
 * to `wait` seconds (capped at 30) for a new match. `signal` lets the
 * HTTP layer cancel the wait if the client disconnects.
 */
export async function listenHandler(
  store: Store,
  args: ListenArgs,
  signal?: AbortSignal,
): Promise<
  Result<{
    messages: Message[];
    mentions: Message[];
    cursor: number;
    matched: boolean;
  }>
> {
  if (!validNick(args.nick)) return err("invalid nick");
  if (!validChannel(args.channel)) return err("invalid channel name");
  const channel = getChannel(store, args.channel);
  if (!channel) return err("channel not found", 404);

  const predicate = makePredicate({ mention: args.mention, keyword: args.keyword });
  const mentionsOf = (msgs: Message[]): Message[] =>
    msgs.filter((m) => m.mentions.includes(args.nick));

  // Short-circuit: anything in the buffer already satisfies the predicate.
  const initial = messagesSince(channel, args.since_id);
  const initialMatches = initial.messages.filter(predicate);
  touchMember(channel, args.nick, store.clock());
  if (initialMatches.length > 0) {
    return ok({
      messages: initial.messages,
      mentions: mentionsOf(initial.messages),
      cursor: initial.cursor,
      matched: true,
    });
  }

  const waitSec = Math.min(Math.max(args.wait ?? MAX_WAIT_SECONDS, 0), MAX_WAIT_SECONDS);
  const match = await waitForMatch(
    store.waiters,
    args.channel,
    predicate,
    Math.round(waitSec * 1000),
    signal,
  );

  // Re-read the buffer so the caller gets everything that accumulated
  // during the wait, not just the single waking message — matches
  // design.md's "whatever's accumulated" contract.
  const after = messagesSince(channel, args.since_id);
  touchMember(channel, args.nick, store.clock());
  return ok({
    messages: after.messages,
    mentions: mentionsOf(after.messages),
    cursor: after.cursor,
    matched: match !== null,
  });
}

export type WhoArgs = { channel: string; nick: string };

export function whoHandler(
  store: Store,
  args: WhoArgs,
): Result<{ members: MemberPresence[] }> {
  if (!validNick(args.nick)) return err("invalid nick");
  if (!validChannel(args.channel)) return err("invalid channel name");
  const channel = getChannel(store, args.channel);
  if (!channel) return err("channel not found", 404);
  touchMember(channel, args.nick, store.clock());
  const members = listActiveMembers(
    channel,
    store.clock(),
    store.config.inactiveAfterSec,
    store.config.evictAfterSec,
  );
  return ok({ members });
}

export type HistoryArgs = {
  channel: string;
  nick: string;
  limit?: number;
};

export function historyHandler(
  store: Store,
  args: HistoryArgs,
): Result<{ messages: Message[] }> {
  if (!validNick(args.nick)) return err("invalid nick");
  if (!validChannel(args.channel)) return err("invalid channel name");
  const channel = getChannel(store, args.channel);
  if (!channel) return ok({ messages: [] });
  touchMember(channel, args.nick, store.clock());
  return ok({ messages: historyOf(channel, args.limit) });
}
