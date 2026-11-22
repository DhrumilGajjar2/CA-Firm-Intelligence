const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgreSQL `uuid` columns reject malformed ids; check first so a bad path id is a 404, never a 500. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
