/** Bindings and secrets of the Worker. */
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Password for the dashboard. Set with `wrangler secret put DASHBOARD_PASSWORD`. */
  DASHBOARD_PASSWORD: string;
  /**
   * Master secret (32+ random characters). Signs sessions and encrypts the
   * API keys and tokens kept in the database. Set with `wrangler secret put ENCRYPTION_KEY`.
   */
  ENCRYPTION_KEY: string;
}

/** Network and clock, replaceable in tests. */
export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}

export const realDeps: Deps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
};
