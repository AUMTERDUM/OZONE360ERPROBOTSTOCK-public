// Mass-assignment guard — pick only allowed keys from a request body,
// preventing injection of protected fields (id, role, relation FKs, etc.).
export function pickFields<T extends Record<string, unknown>>(
  body: unknown,
  allowed: readonly (keyof T)[],
): Partial<T> {
  const out: Partial<T> = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key as string)) {
      (out as Record<string, unknown>)[key as string] = (body as Record<string, unknown>)[key as string];
    }
  }
  return out;
}
