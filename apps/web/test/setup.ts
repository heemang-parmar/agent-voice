import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * jsdom has no canvas backend. `thinking-orbs` already no-ops when the 2D
 * context is unavailable, so hand it an explicit `null` rather than let jsdom
 * raise its "not implemented" error for every orb that mounts.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => null,
    writable: true,
    configurable: true,
  });
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
    writable: true,
    configurable: true,
  });
}

/*
 * Under this Node/jsdom pairing `window.localStorage` resolves to `undefined`
 * even though jsdom built a real Storage, so the session library would see no
 * storage at all and every persistence test would trivially pass. Install a
 * genuine in-memory Storage instead, and clear it after each test so no
 * conversation leaks from one case into the next.
 */
if (typeof window !== 'undefined' && !window.localStorage) {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => {
      entries.delete(key);
    },
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: storage,
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  // Guarded: the pure reducer/transport suites opt into the node environment,
  // where there is no window to clear.
  if (typeof window !== 'undefined') window.localStorage?.clear();
});
