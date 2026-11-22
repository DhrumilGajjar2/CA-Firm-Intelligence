/** Drops unset filters (undefined, null, empty string) so they are not sent as `?search=`. */
export function cleanParams<T extends object>(query: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  );
}
