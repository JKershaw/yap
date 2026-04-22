import type { Channel, Member } from "../channels/channels.ts";

export type PresenceStatus = "active" | "inactive" | "evicted";

export type MemberPresence = {
  nick: string;
  last_seen_seconds_ago: number;
  inactive: boolean;
};

/**
 * Pure classifier. `now`, `last_poll`, and the thresholds are all in the
 * same epoch (milliseconds for timestamps, seconds for thresholds).
 */
export function classify(
  member: Member,
  now: number,
  inactiveAfterSec: number,
  evictAfterSec: number,
): PresenceStatus {
  const idleSec = (now - member.last_poll) / 1000;
  if (idleSec >= evictAfterSec) return "evicted";
  if (idleSec >= inactiveAfterSec) return "inactive";
  return "active";
}

/**
 * Returns the non-evicted members of a channel. Evicts any member past
 * the threshold as a side-effect — presence is lazily maintained on
 * access, per architecture.md (no background sweep).
 */
export function listActiveMembers(
  channel: Channel,
  now: number,
  inactiveAfterSec: number,
  evictAfterSec: number,
): MemberPresence[] {
  const result: MemberPresence[] = [];
  for (const [nick, member] of channel.members) {
    const status = classify(member, now, inactiveAfterSec, evictAfterSec);
    if (status === "evicted") {
      channel.members.delete(nick);
      continue;
    }
    result.push({
      nick,
      last_seen_seconds_ago: Math.floor((now - member.last_poll) / 1000),
      inactive: status === "inactive",
    });
  }
  return result;
}
