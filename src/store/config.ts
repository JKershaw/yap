import { z } from "zod";

const envSchema = z.object({
  YAP_PORT: z.coerce.number().int().min(0).max(65535).default(0),
  YAP_PASSWORD: z.string().min(1).optional(),
  YAP_BUFFER_SIZE: z.coerce.number().int().positive().default(200),
  YAP_INACTIVE_AFTER: z.coerce.number().int().positive().default(3600),
  YAP_EVICT_AFTER: z.coerce.number().int().positive().default(43200),
  YAP_RATE_LIMIT: z.coerce.number().int().positive().default(30),
});

export type Config = {
  port: number;
  serverPassword?: string;
  bufferSize: number;
  inactiveAfterSec: number;
  evictAfterSec: number;
  rateLimit: number;
};

/**
 * Parses env vars into a domain-shaped Config. Env-var names are the
 * public surface documented in README.md; the internal config keys are
 * named for what they mean so renaming an env var stays a
 * one-line change at the parse boundary.
 *
 * Empty-string values are treated as unset so `YAP_PASSWORD=""` means
 * "no gate" (same as omitting it).
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && v !== "") filtered[k] = v;
  }
  if (!filtered.YAP_PORT && filtered.PORT) filtered.YAP_PORT = filtered.PORT;
  const parsed = envSchema.parse(filtered);
  return {
    port: parsed.YAP_PORT,
    serverPassword: parsed.YAP_PASSWORD,
    bufferSize: parsed.YAP_BUFFER_SIZE,
    inactiveAfterSec: parsed.YAP_INACTIVE_AFTER,
    evictAfterSec: parsed.YAP_EVICT_AFTER,
    rateLimit: parsed.YAP_RATE_LIMIT,
  };
}
