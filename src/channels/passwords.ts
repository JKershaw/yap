import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

const KEY_LEN = 64;
const SALT_LEN = 16;

/**
 * Hashes a channel password with scrypt. Output format is `saltHex:hashHex`
 * so verification can recover the salt without a separate metadata field.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/**
 * Constant-time comparison against a stored hash. Returns false for
 * malformed input rather than throwing, so callers can treat any failure
 * uniformly.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = Uint8Array.from(Buffer.from(saltHex, "hex"));
    expected = Uint8Array.from(Buffer.from(hashHex, "hex"));
  } catch {
    return false;
  }
  if (expected.length !== KEY_LEN || salt.length !== SALT_LEN) return false;
  const actual = Uint8Array.from(scryptSync(password, salt, KEY_LEN));
  return timingSafeEqual(actual, expected);
}
