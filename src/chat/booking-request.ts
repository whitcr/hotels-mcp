const line = /^[ \t]*BOOKING[ \t]*:[ \t]*([^\n]*)$/gim;

export interface BookingRequest { hotel_id: number; block_id?: number }

/**
 * Hidden line `BOOKING: {"hotel_id":123}` (optionally with "block_id"): the customer wants to book that
 * hotel and the interface should open the booking form. The line is never shown. Anything that is not a
 * valid request is dropped silently, so the assistant can never open a form from garbage.
 */
export function splitBookingRequest(text: string): { text: string; booking?: BookingRequest } {
  let booking: BookingRequest | undefined;
  const cleaned = text.replace(line, (_match, rest: string) => {
    try {
      const parsed: unknown = JSON.parse(rest.trim());
      const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
      const hotel = record?.hotel_id, block = record?.block_id;
      if (typeof hotel === "number" && Number.isInteger(hotel) && hotel > 0 && !booking) {
        booking = { hotel_id: hotel, ...(typeof block === "number" && Number.isInteger(block) && block > 0 ? { block_id: block } : {}) };
      }
    } catch { /* not a request */ }
    return "";
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trimEnd(), ...(booking ? { booking } : {}) };
}
