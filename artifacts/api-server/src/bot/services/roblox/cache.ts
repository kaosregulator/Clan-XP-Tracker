/** Simple TTL cache for Roblox API responses. */
interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, Entry<unknown>>();
  private maxEntries: number;

  constructor(maxEntries = 2000) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    if (this.store.size >= this.maxEntries) {
      // Drop oldest ~10% on overflow.
      let i = 0;
      const drop = Math.ceil(this.maxEntries * 0.1);
      for (const k of this.store.keys()) {
        this.store.delete(k);
        if (++i >= drop) break;
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const robloxCache = new TtlCache();

/** Sensible TTLs (ms). */
export const TTL = {
  userId: 30 * 60_000,
  user: 5 * 60_000,
  search: 60_000,
  presence: 30_000,
  thumbnails: 15 * 60_000,
  groups: 5 * 60_000,
  groupIcon: 30 * 60_000,
  friends: 2 * 60_000,
  friendCount: 2 * 60_000,
  badges: 5 * 60_000,
  game: 60_000,
  gameThumb: 15 * 60_000,
  servers: 20_000,
  history: 10 * 60_000,
  inventory: 2 * 60_000,
  gamePasses: 10 * 60_000,
  autocomplete: 45_000,
} as const;
