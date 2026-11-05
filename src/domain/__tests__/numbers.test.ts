import { expect, test } from '@jest/globals';
import { parseWhole } from '../numbers';

test('reads digits as a whole number, blank as null and anything else as NaN', () => {
  expect(parseWhole('12')).toBe(12);
  expect(parseWhole(' 0 ')).toBe(0);
  expect(parseWhole('007')).toBe(7);
  expect(parseWhole('')).toBeNull();
  expect(parseWhole('   ')).toBeNull();
  for (const text of ['1.5', '-3', '+3', '1e2', '12a', 'abc', '1 2'])
    expect(parseWhole(text)).toBeNaN();
});
