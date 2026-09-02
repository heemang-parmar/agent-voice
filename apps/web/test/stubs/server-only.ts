// Test stand-in for the `server-only` guard package. Next.js resolves the real
// package only under the React server condition; vitest has no such condition,
// so the guard is replaced with an empty module here.
export {};
