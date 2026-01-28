import * as crypto from 'crypto';

/**
 * Canonical JSON serialization for deterministic hashing.
 *
 * Rules:
 * 1. Object keys sorted recursively (alphabetical)
 * 2. Date → ISO string
 * 3. Map → sorted entries array (by key)
 * 4. Set → sorted array
 * 5. BigInt → string
 * 6. Arrays preserved in order
 * 7. undefined → omitted (standard JSON)
 * 8. null, number, boolean, string → as-is
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map) {
    const entries = [...value.entries()].sort((a, b) =>
      String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0
    );
    return entries.map(([k, v]) => [canonicalize(k), canonicalize(v)]);
  }

  if (value instanceof Set) {
    return [...value].map(v => canonicalize(v)).sort();
  }

  if (Array.isArray(value)) {
    return value.map(v => canonicalize(v));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = canonicalize(obj[key]);
      if (v !== undefined) {
        sorted[key] = v;
      }
    }
    return sorted;
  }

  return value;
}

export function computeHash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}
