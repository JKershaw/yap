const MENTION_RE = /@([\w-]+)/g;

/**
 * Pulls `@nick` tokens from a message body. Deliberately dumb:
 * no fuzzy matching, no lookup validation. See DESIGN.md → Mentions.
 * The returned order matches first appearance; duplicates are dropped.
 */
export function parseMentions(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const nick = match[1];
    if (nick && !seen.has(nick)) {
      seen.add(nick);
      result.push(nick);
    }
  }
  return result;
}
