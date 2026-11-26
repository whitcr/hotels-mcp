const line = /^[ \t]*CALL_CENTER[ \t]*(?::[ \t]*([^\n]*))?$/gim;

export interface CallRequest { hotel_id?: number }

/**
 * Hidden line `CALL_CENTER: {"hotel_id":123}` (or just `CALL_CENTER`): the customer needs something
 * that only the call center can clarify. The line is never shown; the widget draws a call button.
 */
export function splitCallRequest(text: string): { text: string; call?: CallRequest } {
  let call: CallRequest | undefined;
  const cleaned = text.replace(line, (_match, rest: string | undefined) => {
    call = {};
    const raw = (rest ?? "").trim();
    if (raw.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(raw);
        const id = parsed && typeof parsed === "object" ? (parsed as { hotel_id?: unknown }).hotel_id : undefined;
        if (typeof id === "number" && Number.isInteger(id) && id > 0) call = { hotel_id: id };
      } catch { /* A malformed hidden line still means "offer the call", just without a hotel. */ }
    }
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trimEnd(), ...(call ? { call } : {}) };
}
