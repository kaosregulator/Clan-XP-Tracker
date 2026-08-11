import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type ModalActionRowComponentBuilder,
} from "discord.js";
import { db, clanMembersTable, type Clan } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getClan, getMember, ensureMember, identityFromUser } from "../services/config";
import { statusOf, effectiveGoal, currentProgress, STATUS_LABEL, memberHistory } from "../services/progress";
import { listActive } from "../services/warnings";
import { calendarFor, periodTotals } from "../services/xpLedger";
import { openDispute, hasOpenDisputeFor, warningBelongsTo } from "../services/disputes";
import { activityDate, weekKey, weekRangeLabel, discordRelative, nextWeeklyReset, formatInZone } from "../services/time";
import { logAction } from "../services/logging";
import { renderOffThread } from "../canvas/render-pool";
import {
  ME_CALENDAR,
  ME_WARNINGS,
  ME_HISTORY,
  ME_DISPUTE,
  meDisputeModal,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * ⚔️ MY XP — the member-facing view. Deliberately tiny: where you stand this
 * week, and buttons to see your own calendar, warnings, history and to raise a
 * dispute. Members never enter XP. This is also where staff notes are
 * delivered — a note shows once here and then clears itself.
 */

function progressBar(pct: number): string {
  const filled = Math.round((pct / 100) * 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

/** Deliver (and consume) a pending staff note. Returns the note text, if any. */
async function consumeNote(clan: Clan, userId: string): Promise<string | null> {
  const member = await getMember(clan.guildId, userId);
  const note = member?.notes?.trim();
  if (!note) return null;
  await db
    .update(clanMembersTable)
    .set({ notes: null })
    .where(and(eq(clanMembersTable.guildId, clan.guildId), eq(clanMembersTable.userId, userId)));
  await logAction(clan.guildId, {
    action: "note_read",
    targetUserId: userId,
    targetUsername: member?.username ?? userId,
    details: { note },
  });
  return note;
}

/** Build the MY XP payload for a member (self). Assumes a deferred reply. */
export async function buildMyXp(clan: Clan, interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const user = interaction.user;
  await ensureMember(clan.guildId, identityFromUser(user, interaction.inCachedGuild() ? interaction.member.displayName : undefined));
  const member = await getMember(clan.guildId, user.id);
  const status = member ? statusOf(clan, member) : "notStarted";
  const goal = member ? effectiveGoal(clan, member) : clan.weeklyGoal;
  const progress = member ? currentProgress(clan, member) : 0;
  const pct = Math.min(100, Math.round((progress / Math.max(1, goal)) * 100));

  const embed = new EmbedBuilder()
    .setColor(status === "complete" ? 0x3ba55d : status === "notStarted" ? 0xed4245 : 0xfaa61a)
    .setAuthor({ name: `⚔️ MY XP — ${clan.clanName}`, iconURL: user.displayAvatarURL() })
    .setDescription(
      `**This week** (${weekRangeLabel(weekKey(clan))})\n` +
        (clan.trackingMode === "complete"
          ? `Status: **${STATUS_LABEL[status]}**`
          : `**${progress.toLocaleString()} / ${goal.toLocaleString()} ${clan.activityName}**\n\`${progressBar(pct)}\` ${pct}%`) +
        `\n\nStatus: **${STATUS_LABEL[status]}** · week closes ${discordRelative(nextWeeklyReset(clan))}`
    )
    .setFooter({ text: "Officers enter XP for you after verifying it in-game." });

  // Staff note delivery (one-shot).
  const note = await consumeNote(clan, user.id);
  if (note) {
    embed.addFields({ name: "📩 Message from staff", value: note.slice(0, 1024) });
  }

  const buttons = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ME_CALENDAR).setStyle(ButtonStyle.Secondary).setLabel("My Calendar").setEmoji("📅"),
    new ButtonBuilder().setCustomId(ME_WARNINGS).setStyle(ButtonStyle.Secondary).setLabel("My Warnings").setEmoji("⚠️"),
    new ButtonBuilder().setCustomId(ME_HISTORY).setStyle(ButtonStyle.Secondary).setLabel("My History").setEmoji("📜"),
    new ButtonBuilder().setCustomId(ME_DISPUTE).setStyle(ButtonStyle.Secondary).setLabel("Something Wrong?").setEmoji("❓")
  );

  return { embeds: [embed], components: [buttons] };
}

/** Entry: a member viewing their own /xp progress. */
export async function openMemberView(interaction: ChatInputCommandInteraction, clan: Clan) {
  await interaction.editReply(await buildMyXp(clan, interaction));
}

/* -------------------------------------------------------------- buttons */

export async function handleMeButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action } = parseId(interaction.customId);
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.reply({ ...notConfiguredMessage(false), flags: 64 });
    return;
  }

  if (action === "dispute") {
    // Dispute the member's most recent active warning (or a general dispute).
    const warns = await listActive(clan.guildId, interaction.user.id);
    const warningId = warns[0]?.id ?? null;
    if (warningId !== null && (await hasOpenDisputeFor(clan.guildId, interaction.user.id, warningId))) {
      await interaction.reply({ content: "You already have an open dispute for that warning.", flags: 64 });
      return;
    }
    return void (await interaction.showModal(disputeModal(warningId)));
  }

  await interaction.deferReply({ flags: 64 });
  const userId = interaction.user.id;

  if (action === "calendar") {
    const member = await getMember(clan.guildId, userId);
    if (!member) {
      await interaction.editReply({ content: "No entries yet." });
      return;
    }
    const today = activityDate(clan);
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const view = await calendarFor(clan, member, year, month);
    const totals = await periodTotals(clan, userId);
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const buffer = await renderOffThread("calendarCard", {
      communityName: clan.clanName,
      memberName: interaction.member.displayName,
      activityName: clan.activityName,
      monthLabel: view.monthLabel,
      target: view.target,
      firstWeekday,
      days: view.days.map((d) => ({ day: d.day, amount: d.amount, status: d.status })),
      doneCount: view.doneCount,
      missedCount: view.missedCount,
      monthTotal: view.total,
      week: totals.week,
      allTime: totals.allTime,
    });
    await interaction.editReply({
      content: `📅 ${view.monthLabel}`,
      files: [new AttachmentBuilder(buffer, { name: "my-calendar.png" })],
    });
    return;
  }

  if (action === "warnings") {
    const warns = await listActive(clan.guildId, userId);
    const embed = new EmbedBuilder()
      .setColor(warns.length ? 0xed4245 : 0x3ba55d)
      .setTitle("⚠️ MY WARNINGS")
      .setDescription(
        warns.length
          ? warns
              .map(
                (w) =>
                  `**#${w.id}** · ${formatInZone(w.issuedAt, clan)}\n> ${w.reason}\n_Issued by ${w.issuedByUsername}_`
              )
              .join("\n\n")
          : "✅ You have no active warnings."
      )
      .setFooter({ text: warns.length ? "Think one is wrong? Use ❓ Something Wrong? on your /xp." : "" });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (action === "history") {
    const rows = await memberHistory(clan, userId, 10);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📜 MY HISTORY")
      .setDescription(
        rows.length
          ? rows
              .map((h) => {
                const flag = h.exempt ? "🛡️" : h.onLeave ? "🌙" : h.completed ? "🟢" : "⚠️";
                return `${flag} **${weekRangeLabel(h.weekKey)}** — ${h.progress.toLocaleString()} / ${h.goal.toLocaleString()}`;
              })
              .join("\n")
          : "No archived weeks yet."
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }
}

export async function handleMeModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(false));
    return;
  }
  const { arg } = parseId(interaction.customId);
  const warningId = arg && arg !== "none" ? Number(arg) : null;

  // Ownership guard — a member may only dispute their own warning.
  if (warningId !== null && !(await warningBelongsTo(clan.guildId, interaction.user.id, warningId))) {
    await interaction.editReply({ content: "That warning isn't yours to dispute." });
    return;
  }

  const reason = interaction.fields.getTextInputValue("reason").trim();
  let proofUrl: string | null = null;
  try {
    proofUrl = interaction.fields.getTextInputValue("proof").trim() || null;
  } catch {
    proofUrl = null;
  }
  if (proofUrl && !/^https?:\/\//i.test(proofUrl)) proofUrl = null;

  if (!reason) {
    await interaction.editReply({ content: "Please describe why you think the warning is incorrect." });
    return;
  }

  await openDispute({
    client: interaction.client,
    clan,
    target: interaction.user,
    warningId,
    reason,
    proofUrl,
  });

  await interaction.editReply({
    content:
      "✅ Your dispute was submitted. Staff will review it and you'll get a DM with the outcome." +
      (proofUrl ? "" : "\n_Tip: you can paste a link to a screenshot as proof next time._"),
  });
}

function disputeModal(warningId: number | null): ModalBuilder {
  const rowOf = (input: TextInputBuilder) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(meDisputeModal(warningId === null ? "none" : String(warningId)))
    .setTitle(warningId ? `Dispute warning #${warningId}` : "Dispute a warning")
    .addComponents(
      rowOf(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Why do you think it's incorrect?")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
      ),
      rowOf(
        new TextInputBuilder()
          .setCustomId("proof")
          .setLabel("Proof link (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("https://… a screenshot URL")
      )
    );
}
