import { createBuffer, type Buffer } from "./buffer.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

export type Member = {
  joined_at: number;
  last_poll: number;
};

export type Channel = {
  name: string;
  password_hash?: string;
  buffer: Buffer;
  members: Map<string, Member>;
  next_id: number;
};

export type JoinResult = { ok: true } | { ok: false; error: string };

export function createChannel(
  name: string,
  opts: { bufferSize: number; password?: string },
): Channel {
  return {
    name,
    password_hash: opts.password ? hashPassword(opts.password) : undefined,
    buffer: createBuffer(opts.bufferSize),
    members: new Map(),
    next_id: 1,
  };
}

export function joinChannel(
  channel: Channel,
  nick: string,
  password: string | undefined,
  now: number,
): JoinResult {
  if (channel.password_hash) {
    if (!password) return { ok: false, error: "password required" };
    if (!verifyPassword(password, channel.password_hash)) {
      return { ok: false, error: "bad password" };
    }
  }
  const existing = channel.members.get(nick);
  if (existing) {
    existing.last_poll = now;
  } else {
    channel.members.set(nick, { joined_at: now, last_poll: now });
  }
  return { ok: true };
}

export function leaveChannel(channel: Channel, nick: string): void {
  channel.members.delete(nick);
}

export function touchMember(channel: Channel, nick: string, now: number): void {
  const m = channel.members.get(nick);
  if (m) m.last_poll = now;
}

export function isMember(channel: Channel, nick: string): boolean {
  return channel.members.has(nick);
}
