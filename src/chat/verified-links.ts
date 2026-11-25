import { dateSchema } from "../schemas/hotel.schemas.js";

export interface LinkStay { check_in: string; check_out: string }

export function readLinkStay(value: unknown): LinkStay | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  const arrival = dateSchema.safeParse(data.check_in);
  const departure = dateSchema.safeParse(data.check_out);
  if (!arrival.success || !departure.success || arrival.data >= departure.data) return undefined;
  return { check_in: arrival.data, check_out: departure.data };
}

function withStay(url: string, stay?: LinkStay): string {
  if (!stay) return url;
  const parsed = new URL(url);
  const displayDate = (date: string) => date.split("-").reverse().join(".");
  parsed.searchParams.set("dateArrival", displayDate(stay.check_in));
  parsed.searchParams.set("dateDeparture", displayDate(stay.check_out));
  return parsed.href;
}

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

export function normalizeHotelLinks(text: string, links: Map<number, string>, stay?: LinkStay): {text: string; unverified: boolean} {
  const datedLinks = new Map([...links].map(([id, url]) => [id, withStay(url, readLinkStay(stay))]));
  const known = [...datedLinks.values(), "https://hotels24.ua/uk/groups/"];
  let unverified = false;
  const normalized = text.replace(/https?:\/\/[^\s<>"\]]+/g, (full) => {
    // Match the original returned URL as well, including routes without a numeric hotel ID.
    const original = [...links].find(([, url]) => full.startsWith(url) && /^[),.;!?]*$/.test(full.slice(url.length)));
    if (original) return datedLinks.get(original[0])! + full.slice(original[1].length);
    // Preserve URL punctuation and an outer Markdown closing parenthesis.
    const exact = known.find(url => full.startsWith(url) && /^[),.;!?]*$/.test(full.slice(url.length)));
    if (exact) return full;
    const raw = full.replace(/[),.;!?]+$/, "");
    const suffix = full.slice(raw.length);
    try {
      const parsed = new URL(raw);
      const match = parsed.pathname.match(/(?:-(\d+)\.html|\/hotel\/(\d+)\/?)$/);
      const canonical = match ? datedLinks.get(Number(match[1] ?? match[2])) : undefined;
      // Only repair a known hotel's slug, never trust an external origin.
      if (canonical && parsed.origin === new URL(canonical).origin) return canonical + suffix;
    } catch { /* Leave it flagged for the bounded answer repair. */ }
    unverified = true;
    return full;
  });
  return {text: normalized, unverified};
}

export interface HotelCard {
  id: number;
  name: string;
  url: string;
  photo?: string;
  stars?: number;
  total_price?: number;
  price_per_night?: number;
  currency?: string;
  distance_m?: number;
}

/** Display data for hotels the assistant may recommend; only returned tool data, never model text. */
export function collectHotelCards(output: unknown, cards: Map<number, HotelCard>): void {
  if (!output || typeof output !== "object" || !("hotels" in output) || !Array.isArray(output.hotels)) return;
  const httpUrl = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    try { return ["https:", "http:"].includes(new URL(value).protocol) ? value : undefined; } catch { return undefined; }
  };
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  for (const hotel of output.hotels) {
    if (!hotel || !Number.isInteger(hotel.id) || typeof hotel.name !== "string" || !httpUrl(hotel.url)) continue;
    cards.set(hotel.id, {
      id: hotel.id, name: hotel.name, url: hotel.url,
      photo: httpUrl(Array.isArray(hotel.photos) ? hotel.photos[0] : undefined),
      stars: finite(hotel.stars), total_price: finite(hotel.totalPrice), price_per_night: finite(hotel.pricePerNight),
      currency: typeof hotel.currency === "string" ? hotel.currency : undefined,
      distance_m: finite(hotel.locationMatch?.distanceMeters),
    });
    if (cards.size > 50) cards.delete(cards.keys().next().value!);
  }
}

/** Cards for hotels whose verified (dated) link appears in the final answer, in order of appearance. */
export function cardsForAnswer(text: string, cards: Map<number, HotelCard>, stay?: LinkStay): HotelCard[] {
  const dated = readLinkStay(stay);
  return [...cards.values()]
    .map(card => ({ ...card, url: withStay(card.url, dated) }))
    .map(card => ({ card, at: text.indexOf(card.url) }))
    .filter(entry => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, 5)
    .map(entry => entry.card);
}
