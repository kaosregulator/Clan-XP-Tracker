import { MILITARY_TYCOON_UNIVERSE_ID } from "../roblox/constants";

/**
 * Popular seed universes for live Top ranking and Intelligence auto-snapshots.
 * Keep Military Tycoon first — clan ops care about it most.
 */
export const SCOUT_PRESET_UNIVERSE_IDS = [
  MILITARY_TYCOON_UNIVERSE_ID, // Military Tycoon
  994732206, // Blox Fruits
  383310974, // Adopt Me!
  1686885941, // Brookhaven RP
  4924922222, // Brookhaven (alt)
  245662005, // Jailbreak (legacy seed)
  606849621, // Jailbreak
  3317771874, // Pet Simulator 99
  2440500124, // Doors
  111958650, // Arsenal (legacy seed)
  286090429, // Arsenal
  66654135, // Murder Mystery 2
  1176784616, // Tower Defense Simulator
  920587237, // Bee Swarm Simulator
  2788229376, // Da Hood
  189707, // Natural Disaster Survival
  4777817887, // Blade Ball
] as const;

/** Universe IDs auto-snapshotted for Intelligence boards (cap keeps Roblox calls bounded). */
export function scoutIntelSnapshotIds(extra: number[] = []): number[] {
  return Array.from(
    new Set(
      [...SCOUT_PRESET_UNIVERSE_IDS, ...extra].filter((n) => Number.isFinite(n) && n > 0)
    )
  ).slice(0, 40);
}
