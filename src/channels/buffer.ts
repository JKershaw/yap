import type { Message } from "../messages/messages.ts";

export type Buffer = {
  items: Message[];
  capacity: number;
};

export function createBuffer(capacity: number): Buffer {
  return { items: [], capacity };
}

export function append(buf: Buffer, msg: Message): void {
  buf.items.push(msg);
  if (buf.items.length > buf.capacity) {
    buf.items.shift();
  }
}

export function since(buf: Buffer, sinceId: number): Message[] {
  return buf.items.filter((m) => m.id > sinceId);
}

export function recent(buf: Buffer, limit?: number): Message[] {
  if (limit === undefined || limit >= buf.items.length) {
    return buf.items.slice();
  }
  return buf.items.slice(-limit);
}

export function oldestId(buf: Buffer): number | undefined {
  return buf.items[0]?.id;
}
