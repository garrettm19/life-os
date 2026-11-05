import { beforeEach, describe, jest } from '@jest/globals';
import * as store from '../trading-store';
import { tradingStoreCases } from './trading-store-cases';

// The device's store, over a stand-in for the SQLite key-value store.
const mockKv = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getAllKeysAsync: async () => [...mockKv.keys()],
    getItemAsync: async (key: string) => mockKv.get(key) ?? null,
  },
}));
beforeEach(() => mockKv.clear());

describe('the device trading store', () =>
  tradingStoreCases(
    store,
    (key, raw) => mockKv.set(key, raw),
    () => [...mockKv.entries()],
  ));
