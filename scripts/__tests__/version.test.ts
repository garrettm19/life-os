import { describe, expect, it } from '@jest/globals';

// The app version is declared twice: npm reads package.json and the native build reads app.json.
const pkg = require('../../package.json') as { version: string };
const app = require('../../app.json') as { expo: { version: string } };

describe('release version', () => {
  it('is the same in package.json and app.json', () => {
    expect(app.expo.version).toBe(pkg.version);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
