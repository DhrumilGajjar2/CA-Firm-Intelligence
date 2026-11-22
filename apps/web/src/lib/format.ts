/** A valid IANA zone, else undefined (the browser zone), so a bad value never throws while rendering. */
function safeZone(timeZone?: string): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/** "21 Nov 2026" in the firm timezone. */
export function formatDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: safeZone(timeZone),
  }).format(date);
}

/** "21 Nov 2026, 3:30 pm" in the firm timezone. */
export function formatDateTime(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: safeZone(timeZone),
  }).format(date);
}
