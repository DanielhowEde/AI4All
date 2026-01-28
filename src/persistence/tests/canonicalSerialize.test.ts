import { canonicalStringify, computeHash } from '../canonicalSerialize';

describe('canonicalStringify', () => {
  it('should sort object keys alphabetically', () => {
    const result = canonicalStringify({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('should sort nested object keys recursively', () => {
    const result = canonicalStringify({ b: { z: 1, a: 2 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it('should convert Date to ISO string', () => {
    const d = new Date('2026-01-28T12:00:00Z');
    const result = canonicalStringify({ ts: d });
    expect(result).toBe('{"ts":"2026-01-28T12:00:00.000Z"}');
  });

  it('should convert Map to sorted entries array', () => {
    const m = new Map<string, number>([['b', 2], ['a', 1]]);
    const result = canonicalStringify(m);
    expect(result).toBe('[["a",1],["b",2]]');
  });

  it('should convert Set to sorted array', () => {
    const s = new Set(['c', 'a', 'b']);
    const result = canonicalStringify(s);
    expect(result).toBe('["a","b","c"]');
  });

  it('should convert BigInt to string', () => {
    const result = canonicalStringify({ amount: BigInt('1000000') });
    expect(result).toBe('{"amount":"1000000"}');
  });

  it('should preserve array order', () => {
    const result = canonicalStringify([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('should omit undefined values', () => {
    const result = canonicalStringify({ a: 1, b: undefined, c: 3 });
    expect(result).toBe('{"a":1,"c":3}');
  });

  it('should handle null', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify({ a: null })).toBe('{"a":null}');
  });

  it('should produce deterministic output regardless of insertion order', () => {
    const obj1: Record<string, number> = {};
    obj1.z = 1; obj1.a = 2; obj1.m = 3;

    const obj2: Record<string, number> = {};
    obj2.a = 2; obj2.m = 3; obj2.z = 1;

    expect(canonicalStringify(obj1)).toBe(canonicalStringify(obj2));
  });

  it('should handle complex nested structures', () => {
    const value = {
      contributors: new Map([
        ['bob', { rep: 1.0, blocks: 5 }],
        ['alice', { rep: 0.9, blocks: 10 }],
      ]),
      canaryIds: new Set(['c2', 'c1']),
      timestamp: new Date('2026-01-28T12:00:00Z'),
      dayNumber: 1,
    };

    const result1 = canonicalStringify(value);
    const result2 = canonicalStringify(value);
    expect(result1).toBe(result2);

    // Verify keys are sorted
    const parsed = JSON.parse(result1);
    expect(Object.keys(parsed)).toEqual(['canaryIds', 'contributors', 'dayNumber', 'timestamp']);
  });
});

describe('computeHash', () => {
  it('should produce a 64-char hex SHA-256 hash', () => {
    const hash = computeHash('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce different hashes for different inputs', () => {
    expect(computeHash('a')).not.toBe(computeHash('b'));
  });

  it('should produce same hash for same input', () => {
    expect(computeHash('test')).toBe(computeHash('test'));
  });
});
