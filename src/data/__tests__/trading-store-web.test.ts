import { beforeEach, describe } from '@jest/globals';
import * as store from '../trading-store.web';
import { tradingStoreCases } from './trading-store-cases';

// The browser preview's store, over localStorage.
const local = new Map<string, string>();
beforeEach(() => {
  local.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      get length() {
        return local.size;
      },
      key: (i: number) => [...local.keys()][i] ?? null,
      getItem: (key: string) => local.get(key) ?? null,
    },
  };
});

describe('the browser trading store', () =>
  tradingStoreCases(
    store,
    (key, raw) => local.set(key, raw),
    () => [...local.entries()],
  ));
