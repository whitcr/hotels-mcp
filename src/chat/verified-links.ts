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

export type CardBadge = "economy" | "mid" | "comfort" | "best_price" | "nearest";

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
  distance_type?: string;
  price_tier?: "economy" | "mid" | "comfort";
  /** One factual sentence written by the assistant from returned data; shown on the card. */
  summary?: string;
  min_stay_nights?: number;
  missing?: string[];
  badges?: CardBadge[];
}

/** Display data for hotels the assistant may recommend; only returned tool data, never model text. */
export function collectHotelCards(output: unknown, cards: Map<number, HotelCard>): void {
  if (!output || typeof output !== "object" || !("hotels" in output) || !Array.isArray(output.hotels)) return;
  const httpUrl = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    try { return ["https:", "http:"].includes(new URL(value).protocol) ? value : undefined; } catch { return undefined; }
  };
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const tiers = ["economy", "mid", "comfort"] as const;
  for (const hotel of output.hotels) {
    if (!hotel || !Number.isInteger(hotel.id) || typeof hotel.name !== "string" || !httpUrl(hotel.url)) continue;
    const missing = Array.isArray(hotel.missingPreferences)
      ? hotel.missingPreferences.filter((item: unknown): item is string => typeof item === "string" && item.length > 0 && item.length <= 60).slice(0, 2) : [];
    cards.set(hotel.id, {
      id: hotel.id, name: hotel.name, url: hotel.url,
      photo: httpUrl(Array.isArray(hotel.photos) ? hotel.photos[0] : undefined),
      stars: finite(hotel.stars), total_price: finite(hotel.totalPrice), price_per_night: finite(hotel.pricePerNight),
      currency: typeof hotel.currency === "string" ? hotel.currency : undefined,
      distance_m: finite(hotel.locationMatch?.distanceMeters),
      distance_type: typeof hotel.locationMatch?.type === "string" ? hotel.locationMatch.type : undefined,
      price_tier: tiers.find(tier => tier === hotel.priceTier),
      min_stay_nights: Number.isInteger(hotel.minimumStayNights) ? hotel.minimumStayNights : undefined,
      missing: missing.length ? missing : undefined,
    });
    if (cards.size > 50) cards.delete(cards.keys().next().value!);
  }
}

/** Labels computed only from the cards actually shown together: tier, cheapest, nearest. */
export function decorateCards(cards: HotelCard[]): HotelCard[] {
  const unique = <T>(items: Array<{ card: HotelCard; value: T }>, better: (a: T, b: T) => boolean): HotelCard | undefined => {
    if (items.length < 2) return undefined;
    const best = items.reduce((a, b) => better(b.value, a.value) ? b : a);
    return items.some(item => item !== best && item.value === best.value) ? undefined : best.card;
  };
  const cheapest = unique(cards.flatMap(card => card.price_per_night !== undefined ? [{ card, value: card.price_per_night }] : []), (a, b) => a < b);
  const nearest = unique(cards.flatMap(card => card.distance_m !== undefined ? [{ card, value: card.distance_m }] : []), (a, b) => a < b);
  return cards.map(card => {
    const badges: CardBadge[] = [];
    if (card.price_tier) badges.push(card.price_tier);
    if (card === cheapest) badges.push("best_price");
    if (card === nearest) badges.push("nearest");
    return badges.length ? { ...card, badges } : card;
  });
}

function datedCard(card: HotelCard, stay?: LinkStay): HotelCard {
  return { ...card, url: withStay(card.url, readLinkStay(stay)) };
}

/** Cards for hotels the model chose by id; only hotels returned by tools in this conversation can appear. */
export function cardsForIds(items: Array<{ id: number; summary?: string }>, cards: Map<number, HotelCard>, stay?: LinkStay): HotelCard[] {
  return decorateCards(items.flatMap(item => {
    const card = cards.get(item.id);
    return card ? [{ ...datedCard(card, stay), ...(item.summary ? { summary: item.summary } : {}) }] : [];
  }).slice(0, 5));
}

/** Cards for hotels whose verified (dated) link appears in the final answer, in order of appearance. */
export function cardsForAnswer(text: string, cards: Map<number, HotelCard>, stay?: LinkStay): HotelCard[] {
  return decorateCards([...cards.values()]
    .map(card => datedCard(card, stay))
    .map(card => ({ card, at: text.indexOf(card.url) }))
    .filter(entry => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, 5)
    .map(entry => entry.card));
}
