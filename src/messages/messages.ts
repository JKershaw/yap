import { nextId } from "./ids.ts";
import { parseMentions } from "./mentions.ts";
import { append, since, recent, oldestId, type Buffer } from "../channels/buffer.ts";

export type MessageType = "message" | "action" | "system";

export type Message = {
  id: number;
  channel: string;
  nick: string;
  text: string;
  type: MessageType;
  timestamp: number;
  mentions: string[];
};

type ChannelView = {
  name: string;
  next_id: number;
  buffer: Buffer;
};

export function appendMessage(
  channel: ChannelView,
  nick: string,
  text: string,
  type: MessageType = "message",
  now: () => number = Date.now,
): Message {
  const msg: Message = {
    id: nextId(channel),
    channel: channel.name,
    nick,
    text,
    type,
    timestamp: now(),
    mentions: parseMentions(text),
  };
  append(channel.buffer, msg);
  return msg;
}

export function messagesSince(
  channel: ChannelView,
  sinceId?: number,
): { messages: Message[]; truncated: boolean; cursor: number } {
  if (sinceId === undefined) {
    const messages = recent(channel.buffer);
    return {
      messages,
      truncated: true,
      cursor: messages.length === 0 ? 0 : messages[messages.length - 1]!.id,
    };
  }
  const messages = since(channel.buffer, sinceId);
  const oldest = oldestId(channel.buffer);
  const truncated = oldest !== undefined && sinceId < oldest;
  const cursor = messages.length === 0 ? sinceId : messages[messages.length - 1]!.id;
  return { messages, truncated, cursor };
}

export function historyOf(channel: ChannelView, limit?: number): Message[] {
  return recent(channel.buffer, limit);
}
