/** Current calendar date (YYYY-MM-DD) in Ukraine, where customers plan their stays. */
export function todayInKyiv(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
