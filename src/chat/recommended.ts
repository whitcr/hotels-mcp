const line = /^[ \t]*RECOMMENDED[ \t]*:[ \t]*(\[[^\n]*\])[ \t]*$/gim;

/** Hidden line with the internal ids of hotels the interface should show as cards. */
export function splitRecommended(text: string): { text: string; ids: number[] } {
  const ids: number[] = [];
  const cleaned = text.replace(line, (_match, encoded: string) => {
    try {
      const parsed: unknown = JSON.parse(encoded);
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          if (Number.isInteger(value) && (value as number) > 0 && !ids.includes(value as number)) ids.push(value as number);
        }
      }
    } catch { /* A malformed hidden line is dropped, never shown. */ }
    return "";
  });
  // A dangling, unparsable marker must not reach the customer either.
  const hidden = cleaned.replace(/^[ \t]*RECOMMENDED[ \t]*:.*$/gim, "");
  return { text: hidden.replace(/\n{3,}/g, "\n\n").trimEnd(), ids: ids.slice(0, 5) };
}
