export function collectHotelLinks(output: unknown, links: Map<number, string>): void {
  if (!output || typeof output !== "object" || !("hotels" in output) || !Array.isArray(output.hotels)) return;
  for (const hotel of output.hotels) {
    if (!hotel || !Number.isInteger(hotel.id) || typeof hotel.url !== "string") continue;
    try {
      const url = new URL(hotel.url);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      links.set(hotel.id, hotel.url);
      if (links.size > 50) links.delete(links.keys().next().value!);
    } catch { /* A malformed tool URL cannot authorize a recommendation link. */ }
  }
}

export function normalizeHotelLinks(text: string, links: Map<number, string>): {text: string; unverified: boolean} {
  const known = [...links.values()];
  let unverified = false;
  const normalized = text.replace(/https?:\/\/[^\s<>"\]]+/g, (full) => {
    // Preserve URL punctuation and an outer Markdown closing parenthesis.
    const exact = known.find(url => full.startsWith(url) && /^[),.;!?]*$/.test(full.slice(url.length)));
    if (exact) return full;
    const raw = full.replace(/[),.;!?]+$/, "");
    const suffix = full.slice(raw.length);
    try {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/(?:-(\d+)\.html|\/hotel\/(\d+)\/?)$/);
      const canonical = match ? links.get(Number(match[1] ?? match[2])) : undefined;
      // Only repair a known hotel's slug, never trust an external origin.
      if (canonical && parsed.origin === new URL(canonical).origin) return canonical + suffix;
    } catch { /* Leave it flagged for the bounded answer repair. */ }
    unverified = true;
    return full;
  });
  return {text: normalized, unverified};
}
