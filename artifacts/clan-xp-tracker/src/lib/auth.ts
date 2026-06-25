const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function loginWithDiscord() {
  window.location.href = `${BASE}/api/auth/discord`;
}

export function getDiscordAvatarUrl(
  userId: string,
  avatarHash: string | null | undefined,
  size = 64,
): string {
  if (!avatarHash) {
    const disc = (BigInt(userId) >> 22n) % 6n;
    return `https://cdn.discordapp.com/embed/avatars/${disc}.png`;
  }
  const ext = avatarHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
}

export function getGuildIconUrl(
  guildId: string,
  iconHash: string | null | undefined,
  size = 64,
): string {
  if (!iconHash) return `https://cdn.discordapp.com/embed/avatars/0.png`;
  const ext = iconHash.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${ext}?size=${size}`;
}
