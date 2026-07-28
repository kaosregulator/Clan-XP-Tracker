import type { Guild } from "discord.js";
import type { MemberIdentity } from "./config";
import { identityFromUser } from "./config";

/**
 * Resolve every human member of a role to a MemberIdentity — the unit all
 * bulk XP operations work on. Fetches the full member list once (required
 * for role membership to be accurate on large guilds).
 */
export async function roleMemberIdentities(
  guild: Guild,
  roleId: string
): Promise<MemberIdentity[]> {
  await guild.members.fetch().catch(() => null);
  const role = guild.roles.cache.get(roleId);
  if (!role) return [];
  return [...role.members.values()]
    .filter((m) => !m.user.bot)
    .map((m) => identityFromUser(m.user, m.displayName));
}

/** User ids of members holding ANY of the given roles. */
export async function memberIdsWithRoles(
  guild: Guild,
  roleIds: string[]
): Promise<string[]> {
  if (!roleIds.length) return [];
  await guild.members.fetch().catch(() => null);
  const ids = new Set<string>();
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    for (const m of role.members.values()) {
      if (!m.user.bot) ids.add(m.id);
    }
  }
  return [...ids];
}
