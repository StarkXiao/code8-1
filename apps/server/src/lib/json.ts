/** SQLite 中 JSON 一律以 TEXT 存储，这里集中做序列化与容错解析 */

export function stringifyJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function parseJsonArray(text: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(text, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === 'string');
}

export function parseNumberArray(text: string | null | undefined): number[] | null {
  const parsed = parseJson<unknown>(text, null);
  if (!Array.isArray(parsed)) return null;
  const values = parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return values.length ? values : null;
}
