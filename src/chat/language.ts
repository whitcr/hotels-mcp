export type ChatLanguage = "uk" | "ru" | "en";
export const languageNames: Record<ChatLanguage, string> = {uk:"Ukrainian",ru:"Russian",en:"English"};
export function validLanguage(value: unknown): ChatLanguage | undefined {
  return value === "uk" || value === "ru" || value === "en" ? value : undefined;
}

// Only the customer's own words determine language, never appended hotel data.
export function detectMessageLanguage(message: string): ChatLanguage | undefined {
  const text=message.split(/\n\nHotel page context/i)[0]!.replace(/https?:\/\/\S+/g,"").toLowerCase();
  const explicit=text.match(/^(?:(?:please\s+)?(?:reply|respond|answer|write)(?:\s+to me)?(?:\s+in)?|(?:відповідай|пиши|отвечай|ответь)(?:\s+на)?)\s+(english|англійськ\p{L}*|английск\p{L}*|ukrainian|українськ\p{L}*|украинск\p{L}*|russian|російськ\p{L}*|русск\p{L}*)/iu);
  if(explicit){
    if(/^(english|англій|англий)/u.test(explicit[1]!))return "en";
    return /^(ukrainian|україн|украин)/u.test(explicit[1]!)?"uk":"ru";
  }
  const englishWords=text.match(/\b(find|please|show|change|keep|thanks|thank|want|need|adults|guests|night|nights|other|same|hello|book|booking|budget|for|tell|about|the)\b/gi)??[];
  if(englishWords.length>=2 && (text.match(/[a-z]/gi)??[]).length>(text.match(/[а-яіїєґ]/giu)??[]).length) return "en";
  if(/[іїєґ]/u.test(text) && !/[ыэёъ]/u.test(text))return "uk";
  if(/[ыэёъ]/u.test(text) && !/[іїєґ]/u.test(text))return "ru";
  const words=text.match(/\p{L}+/gu)??[];
  const uk=new Set(["готель","готелі","так","потрібен","двох","будь","ласка","знайди","вокзалу","гостей","номер"]);
  const ru=new Set(["отель","отели","да","нет","нужен","двоих","пожалуйста","найди","вокзала","гостей","номер"]);
  const ukScore=words.filter(w=>uk.has(w)).length,ruScore=words.filter(w=>ru.has(w)).length;
  if(ukScore>ruScore)return "uk";
  if(ruScore>ukScore)return "ru";
  if(!/[а-яіїєґ]/u.test(text) && /\b(find|hotel|hotels|please|show|change|keep|thanks|thank|want|need|adults|guests|night|nights|other|same|yes|no|hello|book|booking|budget|for)\b/i.test(text))return "en";
  return undefined; // Dates, numbers and "OK" preserve the conversation language.
}

function prose(text: string): string {
  return text.replace(/\[[^\]]*\]\([^)]*\)/g,"").replace(/https?:\/\/\S+/g,"").replace(/`[^`]*`/g,"");
}

export function answerIssues(text: string, language: ChatLanguage): string[] {
  const visible=prose(text);
  const issues: string[]=[];
  if(!text.trim())issues.push("Return a nonempty customer-facing answer.");
  if(language==="en"){
    const head=visible.slice(0,220);
    const cyrillic=(head.match(/[а-яіїєґ]/giu)??[]).length;
    if(cyrillic>12 && cyrillic>(head.match(/[a-z]/gi)??[]).length)issues.push("Rewrite all prose in English; preserve verified hotel names and URLs.");
  }else{
    const detected=detectMessageLanguage(visible.slice(0,220));
    if(detected && detected!==language)issues.push(`Rewrite prose in ${languageNames[language]}; preserve verified proper names and URLs.`);
  }
  if(/\b(proximity|budget_type|budget_max|hotel_id|city_id|previous_response_id|priceBasis|pricedGuests|unitTotalPrice|max_distance_m|check_in|check_out|budget_currency|exclude_hostels|API)\b/i.test(visible) || (language!=="en" && /\b(downtown|railway|subway|total|per_night)\b/i.test(visible)))issues.push("Remove internal field names and technical error details; translate location and budget terms into ordinary customer language.");
  if(/(?:не\s+(?:зберігаю|зберігаємо|сохраняю|сохраняем)|(?:do not|don['’]t|never)\s+(?:store|save)\s+(?:your\s+)?(?:personal|messages|data))/iu.test(visible))issues.push("Do not claim messages or personal data are never stored. Ask the user not to send personal or payment data; if storage is asked about, describe logging with partial masking accurately.");
  return issues;
}

export function formatAnswerDates(text: string): string {
  // Keep every URL byte-for-byte; only format prose (including bare ISO dates).
  return text.split(/(https?:\/\/[^\s<>]+)/g).map(part=>/^https?:\/\//.test(part)?part:part
    .replace(/YYYY-MM-DD/g,"DD.MM.YYYY")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g,"$3.$2.$1")
  ).join("");
}
