/**
 * Avatar Link Hub (/link) — officers assign a Roblox avatar to a Discord
 * member so warnings / standing cards show the game face (with Discord badge).
 *
 * Flows:
 *  1. Search a Discord member (autocomplete) → search Roblox → confirm
 *  2. Pick a role → walk one-by-one, search/pick Roblox for each, skip/next
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  type AutocompleteInteraction,
  type BaseMessageOptions,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { db, clanMembersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getClan, isOfficer, ensureMember, identityFromUser, getMember } from "../services/config";
import { listTracked } from "../services/progress";
import { RobloxService, logRobloxError, toUserError } from "../services/roblox";
import { renderOffThread } from "../canvas/render-pool";
import { replaceHubCard, clearHubCard } from "../ui/hubMessage";
import { armHubAutoDelete, deferPublicHub } from "../ui/hubVisibility";
import {
  parseId,
  LNK_SEARCH_DISCORD,
  LNK_SEARCH_ROBLOX,
  LNK_DISCORD_MODAL,
  LNK_ROBLOX_MODAL,
  LNK_PICK_ROBLOX,
  LNK_CONFIRM,
  LNK_SKIP,
  LNK_CLEAR,
  LNK_ROLE_PICK,
  LNK_HOME,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";
import { handleMemberSearchAutocomplete } from "./leaderboard";

interface LinkState {
  ownerId: string;
  discordUserId: string | null;
  discordName: string | null;
  discordAvatarUrl: string | null;
  robloxUserId: number | null;
  robloxName: string | null;
  robloxAvatarUrl: string | null;
  queue: string[];
  queueIndex: number;
  ts: number;
}

const hubs = new Map<string, LinkState>();
const TTL = 20 * 60_000;

function prune() {
  const cutoff = Date.now() - TTL;
  for (const [k, v] of hubs) if (v.ts < cutoff) hubs.delete(k);
}
function touch(st: LinkState) {
  st.ts = Date.now();
}
function getHub(messageId: string, userId: string): LinkState | null {
  prune();
  const st = hubs.get(messageId);
  if (!st || st.ownerId !== userId) return null;
  touch(st);
  return st;
}
function bindHub(messageId: string, st: LinkState) {
  prune();
  hubs.set(messageId, st);
}
function fresh(ownerId: string, patch: Partial<LinkState> = {}): LinkState {
  return {
    ownerId,
    discordUserId: null,
    discordName: null,
    discordAvatarUrl: null,
    robloxUserId: null,
    robloxName: null,
    robloxAvatarUrl: null,
    queue: [],
    queueIndex: 0,
    ts: Date.now(),
    ...patch,
  };
}

function row(...c: MessageActionRowComponentBuilder[]) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);
}
function btn(label: string, id: string, style: ButtonStyle = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}

async function fileFrom(fn: string, params: unknown, name: string) {
  return new AttachmentBuilder(await renderOffThread(fn, params), { name });
}

async function loadDiscordIdentity(
  interaction: { client: ChatInputCommandInteraction["client"]; guildId: string | null },
  userId: string
) {
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  if (user) {
    return {
      id: user.id,
      name: user.username,
      avatarUrl: user.displayAvatarURL({ size: 256, extension: "png" }),
    };
  }
  const m = interaction.guildId ? await getMember(interaction.guildId, userId) : null;
  return {
    id: userId,
    name: m?.username ?? "member",
    avatarUrl: m?.avatarUrl ?? null,
  };
}

async function buildView(st: LinkState): Promise<BaseMessageOptions> {
  const queueLabel =
    st.queue.length > 0
      ? `Role walkthrough · ${st.queueIndex + 1} / ${st.queue.length}`
      : null;

  const file = await fileFrom(
    "linkPreview",
    {
      title: st.discordUserId ? "Confirm this match" : "Link a Roblox avatar",
      discordName: st.discordName ?? "Pick a Discord member",
      discordAvatarUrl: st.discordAvatarUrl,
      robloxName: st.robloxName,
      robloxAvatarUrl: st.robloxAvatarUrl,
      robloxUserId: st.robloxUserId,
      queueLabel,
      hint: st.discordUserId
        ? st.robloxUserId
          ? "Looks good? Hit Confirm link to save on their standing & warning cards."
          : "Search Roblox and pick from the top matches."
        : "Pick a Discord user, pick a ROLE to walk, then search Roblox.",
    },
    "avatar-link.png"
  );

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  if (!st.discordUserId) {
    components.push(
      row(btn("Search Discord", LNK_SEARCH_DISCORD, ButtonStyle.Primary)),
      row(
        new RoleSelectMenuBuilder()
          .setCustomId(LNK_ROLE_PICK)
          .setPlaceholder("Or pick a Discord ROLE to walk one-by-one…")
          .setMinValues(1)
          .setMaxValues(1)
      )
    );
  } else {
    components.push(
      row(
        btn("Search Roblox", LNK_SEARCH_ROBLOX, ButtonStyle.Primary),
        btn("Confirm link", LNK_CONFIRM, ButtonStyle.Success, !st.robloxUserId),
        btn("Clear link", LNK_CLEAR, ButtonStyle.Danger),
        btn("Skip", LNK_SKIP, ButtonStyle.Secondary, st.queue.length === 0),
        btn("Done", LNK_HOME)
      )
    );
  }

  return { files: [file], components };
}

async function applyRoblox(st: LinkState, robloxId: number) {
  const user = await RobloxService.getUserById(robloxId);
  const thumbs = await RobloxService.getUserThumbnails(robloxId).catch(() => ({
    headshot: null,
    bust: null,
    fullBody: null,
    avatar3d: null,
  }));
  st.robloxUserId = user.id;
  st.robloxName = user.name;
  st.robloxAvatarUrl = thumbs.headshot || thumbs.bust || thumbs.fullBody;
}

async function saveLink(guildId: string, st: LinkState) {
  if (!st.discordUserId || !st.robloxUserId) {
    throw new Error("Pick both a Discord member and a Roblox user before confirming.");
  }
  const [updated] = await db
    .update(clanMembersTable)
    .set({
      gameUsername: st.robloxName,
      robloxUserId: st.robloxUserId,
      robloxAvatarUrl: st.robloxAvatarUrl,
    })
    .where(
      and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, st.discordUserId))
    )
    .returning({ id: clanMembersTable.id });
  if (!updated) {
    throw new Error("Couldn't find that member in the clan roster — try /link again.");
  }
}

async function clearLink(guildId: string, userId: string) {
  await db
    .update(clanMembersTable)
    .set({ robloxUserId: null, robloxAvatarUrl: null })
    .where(and(eq(clanMembersTable.guildId, guildId), eq(clanMembersTable.userId, userId)));
}

async function advanceQueue(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  st: LinkState
) {
  st.queueIndex += 1;
  st.robloxUserId = null;
  st.robloxName = null;
  st.robloxAvatarUrl = null;
  if (st.queueIndex >= st.queue.length) {
    st.queue = [];
    st.queueIndex = 0;
    st.discordUserId = null;
    st.discordName = null;
    st.discordAvatarUrl = null;
    return;
  }
  const nextId = st.queue[st.queueIndex]!;
  const id = await loadDiscordIdentity(interaction, nextId);
  st.discordUserId = id.id;
  st.discordName = id.name;
  st.discordAvatarUrl = id.avatarUrl;
  const existing = await getMember(interaction.guildId!, nextId);
  if (existing?.robloxUserId) {
    st.robloxUserId = existing.robloxUserId;
    st.robloxName = existing.gameUsername;
    st.robloxAvatarUrl = existing.robloxAvatarUrl;
  }
}

async function startRoleQueue(
  interaction: {
    guild: ChatInputCommandInteraction["guild"];
    guildId: string | null;
    client: ChatInputCommandInteraction["client"];
  },
  st: LinkState,
  roleId: string
): Promise<string | null> {
  const guild = interaction.guild;
  if (!guild || !interaction.guildId) return "This command only works inside a server.";
  const guildId = interaction.guildId;
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role) return "That role couldn't be found.";

  const members = await guild.members.fetch();
  const inRole = [...members.values()]
    .filter((m) => !m.user.bot && m.roles.cache.has(role.id))
    .map((m) => m.id);

  if (!inRole.length) return "That role has no members to walk.";

  st.queue = inRole;
  st.queueIndex = 0;
  const first = await loadDiscordIdentity(interaction, inRole[0]!);
  st.discordUserId = first.id;
  st.discordName = first.name;
  st.discordAvatarUrl = first.avatarUrl;
  st.robloxUserId = null;
  st.robloxName = null;
  st.robloxAvatarUrl = null;
  const existing = await getMember(guildId, first.id);
  if (existing?.robloxUserId) {
    st.robloxUserId = existing.robloxUserId;
    st.robloxName = existing.gameUsername;
    st.robloxAvatarUrl = existing.robloxAvatarUrl;
  }

  // Ensure rows exist for everyone in the walk (best-effort).
  for (const id of inRole.slice(0, 50)) {
    const u = await interaction.client.users.fetch(id).catch(() => null);
    if (u) await ensureMember(guildId, identityFromUser(u));
  }
  return null;
}

export async function handleLinkCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await deferPublicHub(interaction);
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "Only officers can link Roblox avatars." });
    return;
  }

  const st = fresh(interaction.user.id);
  const memberOpt = interaction.options.getString("member");
  const userOpt = interaction.options.getUser("user");
  const roleOpt = interaction.options.getRole("role");
  const targetId = memberOpt || userOpt?.id || null;

  try {
    if (roleOpt && !targetId) {
      const errMsg = await startRoleQueue(interaction, st, roleOpt.id);
      if (errMsg) {
        await interaction.editReply({ content: errMsg });
        return;
      }
    } else if (targetId) {
      const user = await interaction.client.users.fetch(targetId);
      await ensureMember(interaction.guildId, identityFromUser(user));
      st.discordUserId = user.id;
      st.discordName = user.username;
      st.discordAvatarUrl = user.displayAvatarURL({ size: 256, extension: "png" });
      const existing = await getMember(interaction.guildId, user.id);
      if (existing?.robloxUserId) {
        st.robloxUserId = existing.robloxUserId;
        st.robloxName = existing.gameUsername;
        st.robloxAvatarUrl = existing.robloxAvatarUrl;
      }
      const rbx = interaction.options.getString("roblox");
      if (rbx) {
        const resolved = /^\d+$/.test(rbx)
          ? await RobloxService.getUserById(Number(rbx))
          : await RobloxService.resolveUsername(rbx);
        await applyRoblox(st, resolved.id);
      }
    }
    const payload = await buildView(st);
    const msg = await interaction.editReply(replaceHubCard(payload));
    bindHub(msg.id, st);
    armHubAutoDelete(msg);
  } catch (err) {
    logRobloxError("handleLinkCommand", err);
    await interaction.editReply(clearHubCard(toUserError(err)));
  }
}

export async function handleLinkAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === "member") {
    return handleMemberSearchAutocomplete(interaction);
  }
  if (focused.name === "roblox") {
    const q = String(focused.value ?? "").trim();
    if (q.length < 2) {
      await interaction.respond([]);
      return;
    }
    try {
      const hits = await RobloxService.searchUsers(q, 10);
      await interaction.respond(
        hits.slice(0, 10).map((h) => ({
          name: `${h.displayName} (@${h.name})`.slice(0, 100),
          value: String(h.id),
        }))
      );
    } catch {
      await interaction.respond([]).catch(() => {});
    }
    return;
  }
  await interaction.respond([]);
}

export async function handleLinkButton(interaction: ButtonInteraction) {
  const st = getHub(interaction.message.id, interaction.user.id);
  if (!st) {
    await interaction.reply({
      content: "This link hub belongs to someone else — run `/link` to open yours.",
      flags: 64,
    });
    return;
  }
  const { action } = parseId(interaction.customId);

  if (action === "searchDiscord") {
    const modal = new ModalBuilder()
      .setCustomId(LNK_DISCORD_MODAL)
      .setTitle("Find Discord member")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("query")
            .setLabel("Username (or paste Discord user ID)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(40)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === "searchRoblox") {
    const modal = new ModalBuilder()
      .setCustomId(LNK_ROBLOX_MODAL)
      .setTitle("Search Roblox user")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("query")
            .setLabel("Roblox username or user ID")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(40)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferUpdate();

  try {
    if (action === "home") {
      Object.assign(st, fresh(st.ownerId));
      const payload = await buildView(st);
      await interaction.editReply(replaceHubCard(payload));
      armHubAutoDelete(interaction.message);
      return;
    }

    if (action === "refresh") {
      const payload = await buildView(st);
      await interaction.editReply(replaceHubCard(payload));
      armHubAutoDelete(interaction.message);
      return;
    }

    if (action === "confirm") {
      if (!st.discordUserId || !st.robloxUserId) {
        await interaction.followUp({
          content: "Pick a Discord member and a Roblox user first, then hit Confirm link.",
          flags: 64,
        });
        return;
      }
      const user = await interaction.client.users.fetch(st.discordUserId).catch(() => null);
      if (user) await ensureMember(interaction.guildId!, identityFromUser(user));
      await saveLink(interaction.guildId!, st);
      const linkedName = st.discordName ?? "member";
      const linkedRbx = st.robloxName ?? "Roblox";
      if (st.queue.length) {
        await advanceQueue(interaction, st);
      }
      const payload = await buildView(st);
      // Surface success in the card title for the next person / idle state.
      if (!st.queue.length) {
        payload.content = `✅ Linked **${linkedName}** → **${linkedRbx}**. Standing & warning cards will use this face.`;
      } else {
        payload.content = `✅ Linked **${linkedName}** → **${linkedRbx}**. Next member in the role walk…`;
      }
      await interaction.editReply(replaceHubCard(payload));
      bindHub(interaction.message.id, st);
      armHubAutoDelete(interaction.message);
      return;
    }

    if (action === "clear" && st.discordUserId) {
      await clearLink(interaction.guildId!, st.discordUserId);
      st.robloxUserId = null;
      st.robloxName = null;
      st.robloxAvatarUrl = null;
      const payload = await buildView(st);
      await interaction.editReply(replaceHubCard(payload));
      bindHub(interaction.message.id, st);
      armHubAutoDelete(interaction.message);
      return;
    }

    if (action === "skip" && st.queue.length) {
      await advanceQueue(interaction, st);
      const payload = await buildView(st);
      await interaction.editReply(replaceHubCard(payload));
      bindHub(interaction.message.id, st);
      armHubAutoDelete(interaction.message);
    }
  } catch (err) {
    logRobloxError("handleLinkButton", err);
    await interaction
      .followUp({ content: toUserError(err), flags: 64 })
      .catch(() => {});
  }
}

export async function handleLinkSelect(interaction: StringSelectMenuInteraction) {
  const st = getHub(interaction.message.id, interaction.user.id);
  if (!st) {
    await interaction.reply({
      content: "This link hub belongs to someone else — run `/link`.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
  const { action } = parseId(interaction.customId);
  const value = interaction.values[0];
  if (!value) return;

  if (action === "pickRoblox") {
    try {
      await applyRoblox(st, Number(value));
      const payload = await buildView(st);
      await interaction.editReply(replaceHubCard(payload));
      bindHub(interaction.message.id, st);
      armHubAutoDelete(interaction.message);
    } catch (err) {
      await interaction.followUp({ content: toUserError(err), flags: 64 }).catch(() => {});
    }
  }
}

export async function handleLinkRoleSelect(interaction: RoleSelectMenuInteraction) {
  const st = getHub(interaction.message.id, interaction.user.id);
  if (!st) {
    await interaction.reply({
      content: "This link hub belongs to someone else — run `/link`.",
      flags: 64,
    });
    return;
  }
  await interaction.deferUpdate();
  const role = interaction.roles.first();
  if (!role) return;

  const errMsg = await startRoleQueue(interaction, st, role.id);
  if (errMsg) {
    await interaction.followUp({ content: errMsg, flags: 64 });
    return;
  }

  const payload = await buildView(st);
  await interaction.editReply(replaceHubCard(payload));
  bindHub(interaction.message.id, st);
  armHubAutoDelete(interaction.message);
}

export async function handleLinkModal(interaction: ModalSubmitInteraction) {
  const messageId = interaction.message?.id;
  let st = messageId ? getHub(messageId, interaction.user.id) : null;
  await interaction.deferUpdate().catch(async () => {
    await interaction.deferReply({ flags: 64 });
  });
  if (!st) st = fresh(interaction.user.id);

  const { action } = parseId(interaction.customId);
  try {
    if (action === "discordModal") {
      const q = interaction.fields.getTextInputValue("query").trim();
      let userId = /^\d{16,20}$/.test(q) ? q : null;
      if (!userId && interaction.guildId) {
        const tracked = await listTracked(await getClan(interaction.guildId).then((c) => c!));
        const hit = tracked.find(
          (m) =>
            m.username.toLowerCase() === q.toLowerCase() ||
            m.displayName.toLowerCase() === q.toLowerCase() ||
            m.username.toLowerCase().includes(q.toLowerCase())
        );
        userId = hit?.userId ?? null;
      }
      if (!userId) {
        await interaction.followUp({
          content: "Couldn't find that Discord member in this clan's tracked list. Try their user ID.",
          flags: 64,
        });
        return;
      }
      const id = await loadDiscordIdentity(interaction, userId);
      const user = await interaction.client.users.fetch(userId).catch(() => null);
      if (user) await ensureMember(interaction.guildId!, identityFromUser(user));
      st.discordUserId = id.id;
      st.discordName = id.name;
      st.discordAvatarUrl = id.avatarUrl;
      st.robloxUserId = null;
      st.robloxName = null;
      st.robloxAvatarUrl = null;
      const existing = await getMember(interaction.guildId!, userId);
      if (existing?.robloxUserId) {
        st.robloxUserId = existing.robloxUserId;
        st.robloxName = existing.gameUsername;
        st.robloxAvatarUrl = existing.robloxAvatarUrl;
      }
    }

    if (action === "robloxModal") {
      const q = interaction.fields.getTextInputValue("query").trim();
      const hits = /^\d+$/.test(q)
        ? [await RobloxService.getUserById(Number(q))]
        : await RobloxService.searchUsers(q, 10);
      if (!hits.length) {
        await interaction.followUp({ content: "No Roblox users matched that search.", flags: 64 });
        return;
      }
      if (hits.length === 1) {
        await applyRoblox(st, hits[0]!.id);
      } else {
        // Show a pick list of top matches
        await applyRoblox(st, hits[0]!.id); // preview first
        const payload = await buildView(st);
        const select = row(
          new StringSelectMenuBuilder()
            .setCustomId(LNK_PICK_ROBLOX)
            .setPlaceholder("Pick from top Roblox matches…")
            .addOptions(
              hits.slice(0, 10).map((h) => ({
                label: h.name.slice(0, 100),
                description: `ID ${h.id}`.slice(0, 100),
                value: String(h.id),
              }))
            )
        );
        const msg = await interaction.editReply(
          replaceHubCard({ ...payload, components: [...(payload.components ?? []), select] })
        );
        bindHub(msg.id, st);
        armHubAutoDelete(msg);
        return;
      }
    }

    const payload = await buildView(st);
    const msg = await interaction.editReply(replaceHubCard(payload));
    bindHub(msg.id, st);
    armHubAutoDelete(msg);
  } catch (err) {
    logRobloxError("handleLinkModal", err);
    await interaction.followUp({ content: toUserError(err), flags: 64 }).catch(() => {});
  }
}
