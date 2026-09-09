/**
 * `exactOptionalPropertyTypes: true` rejects `{ foo: undefined }` where `foo?: T`.
 * Build objects from optional parts through this helper, so an absent value is an
 * absent key rather than a present `undefined`.
 */
export function omitUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(o)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}
