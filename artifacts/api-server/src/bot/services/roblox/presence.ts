import { postPresenceUsers } from "rozod/endpoints/presencev1";
import { rbxFetch } from "./client";
import { robloxCache, TTL } from "./cache";
import type { PresenceType, RobloxPresence } from "./types";

function mapPresence(raw: {
  userId: number;
  userPresenceType: number;
  lastLocation?: string | null;
  placeId?: number | null;
  rootPlaceId?: number | null;
  universeId?: number | null;
  gameId?: string | null;
}): RobloxPresence {
  return {
    userId: raw.userId,
    userPresenceType: (raw.userPresenceType as PresenceType) ?? 0,
    lastLocation: raw.lastLocation ?? null,
    placeId: raw.placeId ?? null,
    rootPlaceId: raw.rootPlaceId ?? null,
    universeId: raw.universeId ?? null,
    gameId: raw.gameId ?? null,
  };
}

export async function getPresence(userIds: number[]): Promise<Map<number, RobloxPresence>> {
  const out = new Map<number, RobloxPresence>();
  if (userIds.length === 0) return out;

  const missing: number[] = [];
  for (const id of userIds) {
    const cached = robloxCache.get<RobloxPresence>(`presence:${id}`);
    if (cached) out.set(id, cached);
    else missing.push(id);
  }
  if (missing.length === 0) return out;

  // Batch in chunks of 100 (Roblox limit is generous; stay conservative).
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const result = await rbxFetch(postPresenceUsers, {
      body: { userIds: chunk },
    });
    const list =
      (result as { userPresences?: Array<Parameters<typeof mapPresence>[0]> })
        .userPresences ?? [];
    for (const p of list) {
      const mapped = mapPresence(p);
      robloxCache.set(`presence:${mapped.userId}`, mapped, TTL.presence);
      out.set(mapped.userId, mapped);
    }
  }
  return out;
}

export async function getUserPresence(userId: number): Promise<RobloxPresence | null> {
  const map = await getPresence([userId]);
  return map.get(userId) ?? null;
}
