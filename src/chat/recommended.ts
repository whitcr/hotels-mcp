const line = /^[ \t]*RECOMMENDED[ \t]*:[ \t]*(\[[^\n]*\])[ \t]*$/gim;

export interface Recommendation { id: number; summary?: string }

/** One factual sentence for a card. Never links, markup or control characters. */
function cleanSummary(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || /https?:\/\/|www\.|[<>]|[\p{Cc}\p{Cf}]|QUICK_REPLIES|RECOMMENDED/iu.test(text)) return undefined;
  return text.length > 220 ? `${text.slice(0, 219).trimEnd()}…` : text;
}

/**
 * Hidden line with the hotels the interface shows as cards: `[{"id":1,"summary":"..."}]`
 * (a plain `[1,2]` list is accepted too). The line itself is never shown to the customer.
 */
export function splitRecommended(text: string): { text: string; items: Recommendation[] } {
  const items: Recommendation[] = [];
  const cleaned = text.replace(line, (_match, encoded: string) => {
    try {
      const parsed: unknown = JSON.parse(encoded);
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          const record: Record<string, unknown> = value !== null && typeof value === "object" ? value as Record<string, unknown> : { id: value };
          const id = record.id;
          if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || items.some(item => item.id === id)) continue;
          const summary = cleanSummary(record.summary);
          items.push(summary ? { id, summary } : { id });
        }
      }
    } catch { /* A malformed hidden line is dropped, never shown. */ }
    return "";
  });
  // A dangling, unparsable marker must not reach the customer either.
  const hidden = cleaned.replace(/^[ \t]*RECOMMENDED[ \t]*:.*$/gim, "");
  return { text: hidden.replace(/\n{3,}/g, "\n\n").trimEnd(), items: items.slice(0, 5) };
}
