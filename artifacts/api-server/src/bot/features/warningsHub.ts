import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import { db, warningsTable, remindersTable, type Clan } from "@workspace/db";
import { and, eq, desc, gte, isNull, sql } from "drizzle-orm";
import { getClan, isOfficer } from "../services/config";
import { listTracked } from "../services/progress";
import { weekKey, relative, formatInZone } from "../services/time";
import {
  listOpenDisputes,
  getDispute,
  resolveDispute,
  countOpenDisputes,
} from "../services/disputes";
import { openTicket, listOpenTickets, countOpenTickets } from "../services/tickets";
import {
  hubTab,
  HUB_REFRESH,
  HUB_DPICK,
  hubDispute,
  hubDisputeNoteModal,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * ⚠️ WARNINGS & ENFORCEMENT HUB — the single home for reminders, warnings,
 * warning points, the enforcement role, remove-warning, warning history,
 * disputes and tickets. Everything here reads/writes the existing warning,
 * reminder and dispute services; it just organises them into one place.
 */

type HubTab = "overview" | "active" | "reminders" | "history" | "disputes" | "enforcement" | "tickets";

async function hubStats(clan: Clan) {
  const [activeRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, clan.guildId), isNull(warningsTable.removedAt)));
  const [remRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(remindersTable)
    .where(and(eq(remindersTable.guildId, clan.guildId), eq(remindersTable.activityDate, weekKey(clan))));
  const members = await listTracked(clan);
  const warningPoints = members.reduce((s, m) => s + m.warningPoints, 0);
  const disputes = await countOpenDisputes(clan.guildId);
  const tickets = await countOpenTickets(clan.guildId);
  return {
    active: activeRow?.n ?? 0,
    reminders: remRow?.n ?? 0,
    warningPoints,
    disputes,
    tickets,
  };
}

function tabButtons(active: HubTab, disputeCount: number, ticketCount: number): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const b = (tab: HubTab, label: string, emoji: string) =>
    new ButtonBuilder()
      .setCustomId(hubTab(tab))
      .setStyle(tab === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setLabel(label)
      .setEmoji(emoji);
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b("active", "Active Warnings", "⚠️"),
      b("reminders", "Reminders", "🔔"),
      b("history", "History", "📋"),
      b("disputes", `Disputes${disputeCount ? ` (${disputeCount})` : ""}`, "❓")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b("enforcement", "Enforcement", "🎖️"),
      b("tickets", `Tickets${ticketCount ? ` (${ticketCount})` : ""}`, "🎫"),
      new ButtonBuilder().setCustomId(HUB_REFRESH).setStyle(ButtonStyle.Secondary).setLabel("Refresh").setEmoji("🔄")
    ),
  ];
}

async function overviewPayload(clan: Clan): Promise<BaseMessageOptions> {
  const s = await hubStats(clan);
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`⚠️ WARNINGS & ENFORCEMENT — ${clan.clanName}`)
    .setDescription(
      `Active Warnings: **${s.active}**\n` +
        `Reminders (this week): **${s.reminders}**\n` +
        `Warning Points: **${s.warningPoints}**\n` +
        `Open Disputes: **${s.disputes}**\n` +
        `Open Tickets: **${s.tickets}**`
    )
    .setFooter({ text: "Pick a section below." });
  return { embeds: [embed], components: tabButtons("overview", s.disputes, s.tickets) };
}

async function activePayload(clan: Clan): Promise<BaseMessageOptions> {
  const rows = await db
    .select()
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, clan.guildId), isNull(warningsTable.removedAt)))
    .orderBy(desc(warningsTable.issuedAt))
    .limit(15);
  const s = await hubStats(clan);
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("⚠️ Active Warnings")
    .setDescription(
      rows.length
        ? rows
            .map((w) => `**#${w.id}** <@${w.userId}> — ${w.reason.slice(0, 70)} · ${relative(w.issuedAt)} _by ${w.issuedByUsername}_`)
            .join("\n")
        : "✅ No active warnings."
    )
    .setFooter({ text: "Remove a warning from a member's panel: /xp manage → member → 🧹 Remove Warning" });
  return { embeds: [embed], components: tabButtons("active", s.disputes, s.tickets) };
}

async function remindersPayload(clan: Clan): Promise<BaseMessageOptions> {
  const rows = await db
    .select()
    .from(remindersTable)
    .where(and(eq(remindersTable.guildId, clan.guildId), eq(remindersTable.activityDate, weekKey(clan))))
    .orderBy(desc(remindersTable.createdAt))
    .limit(15);
  const s = await hubStats(clan);
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle("🔔 Reminders — this week")
    .setDescription(
      rows.length
        ? rows
            .map((r) => `<@${r.userId}> — ${r.auto ? "auto" : `by ${r.sentByUsername ?? "staff"}`} · ${relative(r.createdAt)}${r.delivered ? "" : " _(undelivered)_"}`)
            .join("\n")
        : "No reminders sent this week yet."
    )
    .setFooter({ text: "Reminders are nudges, not warnings." });
  return { embeds: [embed], components: tabButtons("reminders", s.disputes, s.tickets) };
}

async function historyPayload(clan: Clan): Promise<BaseMessageOptions> {
  const rows = await db
    .select()
    .from(warningsTable)
    .where(eq(warningsTable.guildId, clan.guildId))
    .orderBy(desc(warningsTable.issuedAt))
    .limit(15);
  const s = await hubStats(clan);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋 Warning History")
    .setDescription(
      rows.length
        ? rows
            .map((w) => `${w.removedAt ? "~~" : ""}**#${w.id}** ${w.username} — ${w.reason.slice(0, 60)} · ${formatInZone(w.issuedAt, clan)}${w.removedAt ? "~~ (removed)" : ""}`)
            .join("\n")
        : "No warnings on record."
    );
  return { embeds: [embed], components: tabButtons("history", s.disputes, s.tickets) };
}

async function enforcementPayload(clan: Clan): Promise<BaseMessageOptions> {
  const s = await hubStats(clan);
  const embed = new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle("🎖️ Enforcement")
    .setDescription(
      `**Enforcement role:** ${clan.warningRoleIds.length ? clan.warningRoleIds.map((r) => `<@&${r}>`).join(" ") : "_none set — configure in /setup → Notifications_"}\n\n` +
        `Assigned automatically when a member is warned; removed once they have no active warnings left.\n\n` +
        `**Warn after:** ${clan.warningThreshold} reminder(s) without hitting the goal\n` +
        `**Leadership review at:** ${clan.escalationThreshold} active warning(s)`
    )
    .setFooter({ text: "Completing XP never removes a warning or the enforcement role — that stays staff-managed." });
  return { embeds: [embed], components: tabButtons("enforcement", s.disputes, s.tickets) };
}

async function ticketsPayload(clan: Clan): Promise<BaseMessageOptions> {
  const rows = await listOpenTickets(clan.guildId, 15);
  const s = await hubStats(clan);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎫 Open Tickets")
    .setDescription(
      rows.length
        ? rows.map((t) => `**#${t.id}** <@${t.userId}> — ${t.subject.slice(0, 70)} · ${relative(t.createdAt)}`).join("\n")
        : "No open tickets."
    )
    .setFooter({ text: "Tickets are opened from a dispute (Open Ticket)." });
  return { embeds: [embed], components: tabButtons("tickets", s.disputes, s.tickets) };
}

async function disputesPayload(clan: Clan): Promise<BaseMessageOptions> {
  const disputes = await listOpenDisputes(clan.guildId, 25);
  const s = await hubStats(clan);
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setTitle("❓ Open Disputes")
    .setDescription(
      disputes.length
        ? disputes
            .map((d) => `**#${d.id}** <@${d.userId}> — ${d.reason.slice(0, 70)} · ${relative(d.createdAt)}`)
            .join("\n")
        : "No open disputes. 🎉"
    )
    .setFooter({ text: disputes.length ? "Select a dispute below to review it." : "" });

  const components = tabButtons("disputes", s.disputes, s.tickets);
  if (disputes.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(HUB_DPICK)
      .setPlaceholder("Review a dispute…")
      .addOptions(
        disputes.slice(0, 25).map((d) => ({
          label: `#${d.id} — ${d.username}`.slice(0, 90),
          description: d.reason.slice(0, 90),
          value: String(d.id),
        }))
      );
    components.unshift(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select));
  }
  return { embeds: [embed], components };
}

async function disputeDetailPayload(clan: Clan, disputeId: number): Promise<BaseMessageOptions> {
  const d = await getDispute(clan.guildId, disputeId);
  if (!d) return disputesPayload(clan);
  const embed = new EmbedBuilder()
    .setColor(0xfaa61a)
    .setAuthor({ name: `🚨 Dispute #${d.id} • ${d.username}`, iconURL: d.avatarUrl ?? undefined })
    .setThumbnail(d.avatarUrl ?? null)
    .setDescription(d.reason.slice(0, 2000))
    .addFields(
      { name: "Member", value: `<@${d.userId}>`, inline: true },
      { name: "Warning", value: d.warningId ? `#${d.warningId}` : "General", inline: true },
      { name: "Status", value: d.status, inline: true }
    );
  if (d.proofUrl) embed.setImage(d.proofUrl);

  const actions = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(hubDispute("daccept", d.id)).setStyle(ButtonStyle.Success).setLabel("Accept").setEmoji("✅"),
    new ButtonBuilder().setCustomId(hubDispute("ddeny", d.id)).setStyle(ButtonStyle.Danger).setLabel("Deny").setEmoji("❌"),
    new ButtonBuilder().setCustomId(hubDispute("dinfo", d.id)).setStyle(ButtonStyle.Secondary).setLabel("Ask For More Info").setEmoji("📝"),
    new ButtonBuilder().setCustomId(hubDispute("dticket", d.id)).setStyle(ButtonStyle.Secondary).setLabel("Open Ticket").setEmoji("🎫")
  );
  const back = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(hubTab("disputes")).setStyle(ButtonStyle.Secondary).setLabel("← Back to disputes")
  );
  return { embeds: [embed], components: [actions, back] };
}

async function payloadForTab(clan: Clan, tab: HubTab): Promise<BaseMessageOptions> {
  switch (tab) {
    case "active": return activePayload(clan);
    case "reminders": return remindersPayload(clan);
    case "history": return historyPayload(clan);
    case "disputes": return disputesPayload(clan);
    case "enforcement": return enforcementPayload(clan);
    case "tickets": return ticketsPayload(clan);
    default: return overviewPayload(clan);
  }
}

/* -------------------------------------------------------------- routing */

async function officerGuard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  deferred = false
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    const msg = notConfiguredMessage(isOfficer(interaction.member, null));
    if (deferred) await interaction.editReply(msg);
    else await interaction.reply({ ...msg, flags: 64 });
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    const content = "The Warnings & Enforcement hub is officer-only.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

/** /xp warnings (officers) — open the hub. */
export async function openWarningsHub(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await overviewPayload(clan));
}

export async function handleHubButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action, arg } = parseId(interaction.customId);

  // "Ask for more info" opens a modal — cannot defer first.
  if (action === "dinfo") {
    const clan = await getClan(interaction.guildId);
    if (!clan || !isOfficer(interaction.member, clan)) {
      await interaction.reply({ content: "Officer-only.", flags: 64 });
      return;
    }
    return void (await interaction.showModal(infoModal(Number(arg))));
  }

  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const mod = { id: interaction.user.id, username: interaction.user.username };

  if (action === "tab") {
    return void (await interaction.editReply(await payloadForTab(clan, (arg ?? "overview") as HubTab)));
  }
  if (action === "refresh") {
    return void (await interaction.editReply(await overviewPayload(clan)));
  }
  if (action === "daccept" || action === "ddeny") {
    await resolveDispute({
      client: interaction.client,
      clan,
      disputeId: Number(arg),
      status: action === "daccept" ? "accepted" : "denied",
      moderatorId: mod.id,
      moderatorUsername: mod.username,
    });
    return void (await interaction.editReply(await disputesPayload(clan)));
  }
  if (action === "dticket") {
    const d = await getDispute(clan.guildId, Number(arg));
    if (d) {
      await openTicket({
        guildId: clan.guildId,
        userId: d.userId,
        username: d.username,
        subject: `Dispute #${d.id}${d.warningId ? ` (warning #${d.warningId})` : ""}`,
        disputeId: d.id,
        openedBy: mod.id,
        openedByUsername: mod.username,
      });
      await resolveDispute({
        client: interaction.client,
        clan,
        disputeId: d.id,
        status: "info_requested",
        moderatorId: mod.id,
        moderatorUsername: mod.username,
        note: "A ticket was opened to look into this.",
      });
    }
    return void (await interaction.editReply(await ticketsPayload(clan)));
  }
}

export async function handleHubSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const { action } = parseId(interaction.customId);
  if (action === "dpick") {
    const disputeId = Number(interaction.values[0]);
    await interaction.editReply(await disputeDetailPayload(clan, disputeId));
  }
}

export async function handleHubModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  if (action === "dnote") {
    const note = interaction.fields.getTextInputValue("note").trim();
    await resolveDispute({
      client: interaction.client,
      clan,
      disputeId: Number(arg),
      status: "info_requested",
      moderatorId: interaction.user.id,
      moderatorUsername: interaction.user.username,
      note: note || "Staff asked for more information.",
    });
    await interaction.editReply(await disputesPayload(clan));
  }
}

function infoModal(disputeId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(hubDisputeNoteModal(disputeId))
    .setTitle("Ask for more info")
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("What do you need from the member?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
      )
    );
}
