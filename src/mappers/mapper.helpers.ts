export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

export function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = object(value);
  return record ? Object.values(record) : [];
}

export function number(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function localized(value: unknown, language: string): string | undefined {
  const direct = string(value);
  if (direct) return direct;
  const record = object(value);
  if (!record) return undefined;
  return string(record[language]) ?? string(record.uk) ?? string(record.ru) ?? string(record.en);
}

export function unwrap(value: unknown): unknown {
  const record = object(value);
  if (!record) return value;
  return record.data ?? record.result ?? value;
}

export function textList(value: unknown, language: string): string[] {
  return array(value)
    .map((item) => {
      const record = object(item);
      return localized(record?.name ?? record?.title ?? item, language);
    })
    .filter((item): item is string => Boolean(item));
}

export function plainText(value: unknown): string | undefined {
  const raw = string(value);
  if (!raw) return undefined;
  const text = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

export function conciseText(value: unknown, maxLength = 280): string | undefined {
  const text = plainText(value);
  if (!text || text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength + 1);
  const sentenceEnd = Math.max(shortened.lastIndexOf(". "), shortened.lastIndexOf("! "), shortened.lastIndexOf("? "));
  const boundary = sentenceEnd >= Math.floor(maxLength * 0.55) ? sentenceEnd + 1 : shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary > 0 ? boundary : maxLength).trim()}…`;
}

export function absolutePublicUrl(value: unknown, publicBaseUrl: string, fallbackPath: string): string {
  const base = new URL(publicBaseUrl);
  const raw = string(value);
  if (!raw) return new URL(fallbackPath, base).toString();
  try {
    const candidate = new URL(raw, base);
    if (!["http:", "https:"].includes(candidate.protocol)) return new URL(fallbackPath, base).toString();
    if (candidate.origin !== base.origin) {
      return new URL(`${candidate.pathname}${candidate.search}${candidate.hash}`, base).toString();
    }
    return candidate.toString();
  } catch {
    return new URL(fallbackPath, base).toString();
  }
}
