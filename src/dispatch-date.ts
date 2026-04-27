/**
 * Format an honest-but-friendly dispatch estimate for the customer.
 *
 * Rounds the calculated dispatch date back to the Monday of that week so
 * the phrase "week of Mon 9 Jun" actually starts on a Monday. NZ English
 * date format (day before month). Brand voice: never reads as a
 * guaranteed delivery date — leave the word "Estimated" / "Approximate"
 * to the call site that prefixes the result.
 */
export function formatDispatchWeek(today: Date, leadTimeWeeks: number): string {
  const target = new Date(today.getTime());
  target.setDate(target.getDate() + leadTimeWeeks * 7);

  // Round to the Monday at-or-before the target.
  const dow = target.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  target.setDate(target.getDate() + offsetToMon);

  // Build "Mon 9 Jun" without the locale's default comma.
  const parts = new Intl.DateTimeFormat("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(target);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  return `week of ${weekday} ${day} ${month}`;
}
