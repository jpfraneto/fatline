// Canonical serialization: the one byte string every commitment and seed is computed from.
// Rules: object keys sorted, no whitespace, integers only as plain decimals, other numbers rounded to
// 6 decimals (so float noise across engines can't change a hash), no undefined, no NaN/Infinity.

export function canonical(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'string': return JSON.stringify(value);
    case 'bigint': return value.toString();
    case 'number': {
      if (!Number.isFinite(value)) throw new Error('canonical: numbers must be finite');
      if (Number.isInteger(value)) return String(value);
      const r = Math.round(value * 1e6) / 1e6;
      return Object.is(r, -0) ? '0' : String(r);
    }
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    }
    default: throw new Error(`canonical: cannot serialize ${typeof value}`);
  }
}

/** Rounds every float the same way canonical() does, so values in memory match what was hashed. */
export const round6 = (x) => Math.round(x * 1e6) / 1e6;
