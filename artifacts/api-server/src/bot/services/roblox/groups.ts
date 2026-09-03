import { getUsersUseridGroupsRoles } from "rozod/endpoints/groupsv2";
import { getGroupsGroupid } from "rozod/endpoints/groupsv1";
import { rbxFetch } from "./client";
import { robloxCache, TTL } from "./cache";
import { getGroupIcons } from "./thumbnails";
import { RobloxServiceError } from "./errors";
import type { PageResult, RobloxGroupRole } from "./types";

interface GroupRaw {
  group: {
    id: number;
    name: string;
    memberCount?: number;
  };
  role: {
    id: number;
    name: string;
    rank: number;
  };
}

export async function getUserGroups(userId: number): Promise<RobloxGroupRole[]> {
  const key = `ugroups:${userId}`;
  const cached = robloxCache.get<RobloxGroupRole[]>(key);
  if (cached) return cached;

  const result = await rbxFetch(getUsersUseridGroupsRoles, {
    userId,
    includeLocked: false,
    includeNotificationPreferences: false,
    discoveryType: 0,
  });
  const data = (result as { data?: GroupRaw[] }).data ?? [];
  const icons = await getGroupIcons(data.map((g) => g.group.id));

  const roles: RobloxGroupRole[] = data
    .map((g) => ({
      groupId: g.group.id,
      groupName: g.group.name,
      groupIconUrl: icons.get(g.group.id) ?? null,
      roleName: g.role.name,
      rank: g.role.rank,
      memberCount: g.group.memberCount ?? null,
    }))
    .sort((a, b) => b.rank - a.rank || a.groupName.localeCompare(b.groupName));

  return robloxCache.set(key, roles, TTL.groups);
}

export async function getUserGroupsPage(
  userId: number,
  page = 0,
  pageSize = 6
): Promise<PageResult<RobloxGroupRole>> {
  const all = await getUserGroups(userId);
  const start = page * pageSize;
  const items = all.slice(start, start + pageSize);
  return {
    items,
    page,
    pageSize,
    total: all.length,
    hasMore: start + pageSize < all.length,
  };
}

export async function getGroupMembership(
  userId: number,
  groupId: number
): Promise<RobloxGroupRole | null> {
  const groups = await getUserGroups(userId);
  return groups.find((g) => g.groupId === groupId) ?? null;
}

export async function getGroupDetails(groupId: number): Promise<{
  id: number;
  name: string;
  description: string;
  memberCount: number;
  iconUrl: string | null;
  owner: { id: number; name: string } | null;
}> {
  const key = `group:${groupId}`;
  const cached = robloxCache.get<{
    id: number;
    name: string;
    description: string;
    memberCount: number;
    iconUrl: string | null;
    owner: { id: number; name: string } | null;
  }>(key);
  if (cached) return cached;

  const raw = await rbxFetch(getGroupsGroupid, { groupId });
  const g = raw as unknown as {
    id: number;
    name: string;
    description?: string;
    memberCount?: number;
    owner?: { id?: number; userId?: number; name?: string; username?: string } | null;
  };
  if (!g?.id) throw new RobloxServiceError("not_found", `group ${groupId}`);
  const icons = await getGroupIcons([groupId]);
  const ownerId = g.owner?.id ?? g.owner?.userId;
  const ownerName = g.owner?.name ?? g.owner?.username;
  const details = {
    id: g.id,
    name: g.name,
    description: g.description ?? "",
    memberCount: g.memberCount ?? 0,
    iconUrl: icons.get(groupId) ?? null,
    owner: ownerId != null && ownerName ? { id: ownerId, name: ownerName } : null,
  };
  return robloxCache.set(key, details, TTL.groups);
}
