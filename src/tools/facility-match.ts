// Matching of customer preferences against hotel facilities and descriptions.
// A stem matches the start of a word; a trailing "$" requires the whole word.
const SYNONYM_GROUPS: string[][] = [
  ["парковк", "паркінг", "паркинг", "parking", "стоянк"],
  ["wifi", "wi-fi", "вайфай", "інтернет", "интернет", "wireless"],
  ["тварин", "животн", "питомц", "pet", "собак", "кішк", "кошк"],
  ["сніданок", "снідан", "завтрак", "breakfast"],
  ["саун", "баня", "бані", "баню", "sauna"],
  ["тренажер", "спортзал", "спортивн", "фітнес", "фитнес", "gym", "fitness"],
  ["кондиціонер", "кондиционер", "aircondition", "air condition"],
  ["кухн", "kitchen"],
  ["spa$", "спа$", "wellness", "велнес"],
  ["ресторан", "restaurant"],
  ["трансфер", "transfer"],
  ["дитяч", "детск", "діти", "дети", "kids", "children", "playground", "ігров", "игров"],
  ["пральн", "прачечн", "стирк", "прання", "laundry"],
  ["балкон", "balcony", "терас", "террас", "terrace"],
  ["ліфт", "лифт", "elevator", "lift$"],
  ["інвалід", "инвалид", "безбар", "wheelchair", "accessible"],
  ["цілодобов", "круглосуточ", "24/7", "24 hour", "24-hour"],
  ["бар$", "bar$", "кафе", "cafe"],
  ["мангал", "барбекю", "bbq", "гриль", "grill"],
  ["тиш", "тих", "спокійн", "спокойн", "quiet"],
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stemMatches(text: string, stem: string): boolean {
  const whole = stem.endsWith("$");
  const body = escape((whole ? stem.slice(0, -1) : stem).toLocaleLowerCase());
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}${whole ? "(?![\\p{L}\\p{N}])" : ""}`, "iu").test(text);
}

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function synonymStems(preference: string): string[] {
  return SYNONYM_GROUPS.filter(group => group.some(stem => stemMatches(preference, stem))).flat();
}

/** The fact (facility name) that satisfies the preference, if any. */
export function matchFacility(preference: string, facts: string[]): string | undefined {
  const query = normalize(preference);
  if (query.length < 2) return undefined;
  const stems = synonymStems(preference);
  // Very short wishes ("спа") must match whole words, not fragments of other words.
  const plain = query.length >= 4 ? (fact: string) => normalize(fact).includes(query) : (fact: string) => stemMatches(fact, preference.trim() + "$");
  return facts.find(fact => plain(fact) || stems.some(stem => stemMatches(fact, stem)));
}

/** Softer evidence: the free-text description mentions the preference. Never a confirmed service. */
export function matchDescription(preference: string, description: string | undefined): boolean {
  if (!description) return false;
  const query = normalize(preference);
  if (query.length < 2) return false;
  if (normalize(description).includes(query)) return true;
  if (synonymStems(preference).some(stem => stemMatches(description, stem))) return true;
  const words = (preference.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length >= 4);
  return words.length > 0 && words.every(word => stemMatches(description, word.slice(0, Math.max(4, word.length - 2))));
}
