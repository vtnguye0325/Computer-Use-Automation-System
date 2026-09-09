import { describe, expect, it } from 'vitest';
import { omitUndefined } from '../src/util/object.js';

describe('omitUndefined', () => {
  it('removes keys whose value is undefined', () => {
    const o = omitUndefined({ a: 1, b: undefined });
    expect(Object.hasOwn(o, 'b')).toBe(false);
    expect(o.a).toBe(1);
  });

  it('keeps null, because null is a value the caller chose', () => {
    expect(omitUndefined({ a: null })).toEqual({ a: null });
  });
});
