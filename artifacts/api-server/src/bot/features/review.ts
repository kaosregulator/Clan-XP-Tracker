import {
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Clan } from "@workspace/db";
import PQueue from "p-queue";
import { getClan, isOfficer } from "../services/config";
import {
  listTracked,
  snapshotFrom,
  reminderTargets,
  warningTargets,
  syncRoleFlags,
  rollWeek,
  formatProgress,
  effectiveGoal,
  currentProgress,
} from "../services/progress";
import { sendBulkReminders } from "../services/reminders";
import { issueWarning } from "../services/warnings";
import { exportGuildDataAsXlsx } from "../services/export";
import { memberIdsWithRoles } from "../services/roles";
import { renderOffThread } from "../canvas/render-pool";
import { weekRangeLabel, nextWeeklyReset, formatInZone } from "../services/time";
import { reviewComponents } from "../ui/components";
import { REVIEW_WARN_CONFIRM, REVIEW_RESET_CONFIRM, parseId } from "../ui/ids";
import { notConfiguredMessage } from "./xp";
import type { WeeklyReviewView } from "../canvas/cards/weeklyReviewCard";

/**
 * The weekly review — the officer's flagship view. A canvas summary of the
 * whole clan's week with one-tap bulk actions underneath: Send Reminders,
 * Issue Warnings, Export Report, Refresh, Reset Week.
 */

async function officerGuard(
  interaction: ChatInputCommandInteraction | ButtonInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "The weekly review is officer-only." });
    return null;
  }
  return clan;
}

/** Build the full review payload (canvas + action buttons). */
export async function buildReviewPayload(
  interaction: ChatInputCommandInteraction<"cached"> | ButtonInteraction<"cached">,
  clan: Clan
): Promise<BaseMessageOptions> {
  // Mirror role-based exemptions/leave onto member flags before aggregating,
  // so /setup role settings apply without per-member commands.
  if (clan.exemptRoleIds.length || clan.leaveRoleIds.length) {
    const [exemptIds, leaveIds] = await Promise.all([
      memberIdsWithRoles(interaction.guild, clan.exemptRoleIds),
      memberIdsWithRoles(interaction.guild, clan.leaveRoleIds),
    ]);
    await syncRoleFlags(clan, exemptIds, leaveIds);
  }

  const members = await listTracked(clan);
  const snap = snapshotFrom(clan, members);
  const remindable = reminderTargets(clan, members).length;
  const warnable = warningTargets(clan, members).length;

  const goalLabel =
    clan.trackingMode === "complete"
      ? `Weekly ${clan.activityName} completion`
      : `${clan.weeklyGoal.toLocaleString()} ${clan.activityName} weekly goal`;

  const view: WeeklyReviewView = {
    communityName: clan.clanName,
    activityName: clan.activityName,
    rangeLabel: weekRangeLabel(snap.weekKey),
    deadline: `resets ${formatInZone(nextWeeklyReset(clan), clan, "ddd HH:mm")}`,
    goalLabel,
    tracked: snap.tracked,
    active: snap.active,
    completed: snap.completed,
    inProgress: snap.inProgress,
    notStarted: snap.notStarted,
    exempt: snap.exempt,
    onLeave: snap.onLeave,
    completionRate: snap.completionRate,
    reminders: snap.remindersThisWeek,
    warnings: snap.warningsThisWeek,
  };

  const png = await renderOffThread("weeklyReview", view);
  return {
    files: [new AttachmentBuilder(png, { name: "weekly-review.png" })],
    components: reviewComponents({ remindable, warnable }),
  };
}

/** /xp review entry point. */
export async function openReview(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply();
  const clan = await officerGuard(interaction);
  if (!clan) return;
  await interaction.editReply(await buildReviewPayload(interaction, clan));
}

/* --------------------------------------------------------------- buttons */

export async function handleReviewButton(interaction: ButtonInteraction) {
  if (!interaction.inCachedGuild()) return;
  const { action } = parseId(interaction.customId);

  // Refresh edits the review message in place; everything else replies.
  if (action === "refresh") {
    await interaction.deferUpdate();
    const clan = await officerGuard(interaction);
    if (!clan) return;
    await interaction.editReply(await buildReviewPayload(interaction, clan));
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction);
  if (!clan) return;

  switch (action) {
    case "remind": {
      const members = await listTracked(clan);
      const targets = reminderTargets(clan, members);
      if (!targets.length) {
        await interaction.editReply({ content: "Everyone is complete, exempt or on leave — nobody to remind. 🎉" });
        return;
      }
      const res = await sendBulkReminders({
        client: interaction.client,
        clan,
        targets,
        auto: false,
        moderatorId: interaction.user.id,
        moderatorUsername: interaction.user.username,
        skipIfRemindedToday: true,
      });
      await interaction.editReply({
        content: `🔔 Sent **${res.sent}** reminder(s)${res.skipped ? ` · skipped ${res.skipped} reminded in the last day` : ""}. Refresh the review to see updated counts.`,
      });
      return;
    }

    case "warn": {
      const members = await listTracked(clan);
      const targets = warningTargets(clan, members);
      if (!targets.length) {
        await interaction.editReply({
          content: `Nobody is warning-eligible yet — a member becomes eligible after **${clan.warningThreshold}** reminder(s) in a week without reaching the goal.`,
        });
        return;
      }
      const preview = targets
        .slice(0, 15)
        .map((m) => `• **${m.displayName}** — ${formatProgress(clan, m)} · ${m.weekReminders} reminder(s)`)
        .join("\n");
      const confirm = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(REVIEW_WARN_CONFIRM)
          .setStyle(ButtonStyle.Danger)
          .setLabel(`Confirm — warn ${targets.length} member(s)`)
      );
      await interaction.editReply({
        content:
          `⚠️ **XP warnings** will be issued to **${targets.length}** member(s) still short of the goal after ${clan.warningThreshold}+ reminders:\n\n` +
          `${preview}${targets.length > 15 ? `\n…and ${targets.length - 15} more` : ""}`,
        components: [confirm],
      });
      return;
    }

    case "warnConfirm": {
      const members = await listTracked(clan);
      const targets = warningTargets(clan, members);
      const queue = new PQueue({ concurrency: 2, intervalCap: 2, interval: 1000 });
      let issued = 0;
      const escalate: string[] = [];
      for (const m of targets) {
        queue.add(async () => {
          const user = await interaction.client.users.fetch(m.userId).catch(() => null);
          if (!user) return;
          const { activeCount } = await issueWarning({
            client: interaction.client,
            clan,
            guild: interaction.guild,
            target: user,
            moderatorId: interaction.user.id,
            moderatorUsername: interaction.user.username,
            reason: `Missed the weekly ${clan.activityName} goal (${currentProgress(clan, m).toLocaleString()} / ${effectiveGoal(clan, m).toLocaleString()}) after ${m.weekReminders} reminder(s).`,
          });
          issued++;
          if (activeCount >= clan.escalationThreshold) escalate.push(`<@${m.userId}> (${activeCount})`);
        });
      }
      await queue.onIdle();
      await interaction.editReply({
        content:
          `⚠️ Issued **${issued}** XP warning(s).` +
          (escalate.length
            ? `\n🚨 **Leadership review** — at ${clan.escalationThreshold}+ active warnings: ${escalate.join(", ")}`
            : ""),
        components: [],
      });
      return;
    }

    case "export": {
      const buffer = await exportGuildDataAsXlsx(clan);
      const stamp = new Date().toISOString().slice(0, 10);
      await interaction.editReply({
        content: "📊 Weekly report + full history export:",
        files: [new AttachmentBuilder(buffer, { name: `xp-report-${stamp}.xlsx` })],
      });
      return;
    }

    case "resetWeek": {
      const confirm = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(REVIEW_RESET_CONFIRM)
          .setStyle(ButtonStyle.Danger)
          .setLabel("Confirm — archive & reset the week")
      );
      await interaction.editReply({
        content:
          `♻️ This archives every member's current week${clan.archiveWeeks ? " into history" : " (archiving is OFF in /setup)"} and resets progress to zero. Continue?`,
        components: [confirm],
      });
      return;
    }

    case "resetConfirm": {
      const res = await rollWeek(clan, { id: interaction.user.id, username: interaction.user.username });
      await interaction.editReply({
        content: `♻️ Week reset. Archived **${res.archived}** member record(s); the new week is **${weekRangeLabel(res.weekKey)}**.`,
        components: [],
      });
      return;
    }
  }
}
