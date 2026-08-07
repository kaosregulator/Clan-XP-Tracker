import {
  EmbedBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { db, warningsTable, type Clan, type ClanMember } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getClan, isOfficer } from "../services/config";
import {
  listTracked,
  statusOf,
  formatProgress,
  reminderTargets,
  warningTargets,
} from "../services/progress";
import { weekKey, relative } from "../services/time";
import { dashboardComponents, DASH_FILTERS, type DashFilter } from "../ui/components";
import { parseId } from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * The Warning Dashboard — the enforcement overview that replaces the old
 * leaderboard. Who needs a reminder, who is warning-eligible, who is exempt
 * or on leave, and the most recent warning activity.
 */

const PAGE_SIZE = 12;

function filterMembers(clan: Clan, members: ClanMember[], filter: DashFilter): ClanMember[] {
  const wk = weekKey(clan);
  switch (filter) {
    case "attention": {
      // Warning-eligible first, then fewest-progress first.
      const targets = reminderTargets(clan, members);
      const eligible = new Set(warningTargets(clan, members).map((m) => m.id));
      return targets.sort((a, b) => {
        const ea = eligible.has(a.id) ? 1 : 0;
        const eb = eligible.has(b.id) ? 1 : 0;
        if (ea !== eb) return eb - ea;
        return (b.weekKey === wk ? b.weekReminders : 0) - (a.weekKey === wk ? a.weekReminders : 0);
      });
    }
    case "reminded":
      return members.filter((m) => m.weekKey === wk && m.weekReminders > 0);
    case "warned":
      return members.filter((m) => m.weekKey === wk && m.weekWarnings > 0);
    case "exempt":
      return members.filter((m) => m.exempt);
    case "leave":
      return members.filter((m) => m.onLeave);
  }
}

function memberLine(clan: Clan, m: ClanMember, warnEligible: boolean): string {
  const wk = weekKey(clan);
  const reminders = m.weekKey === wk ? m.weekReminders : 0;
  const warnings = m.weekKey === wk ? m.weekWarnings : 0;
  const status = statusOf(clan, m);
  const badge =
    status === "exempt" ? "🛡️" : status === "leave" ? "🌙" : warnEligible ? "🚨" : reminders > 0 ? "🔔" : "▫️";
  // Compact line: badge · @member · 20/5000 XP   🔔2 ⚠️1 📝
  const meta: string[] = [];
  if (reminders) meta.push(`🔔${reminders}`);
  if (warnings) meta.push(`⚠️${warnings}`);
  if (m.notes) meta.push("📝");
  const head = `${badge} <@${m.userId}> · ${formatProgress(clan, m)}`;
  return meta.length ? `${head}   ${meta.join(" ")}` : head;
}

export async function buildDashboardPayload(
  clan: Clan,
  filter: DashFilter,
  page: number
): Promise<BaseMessageOptions> {
  const members = await listTracked(clan);
  const rows = filterMembers(clan, members, filter);
  const eligible = new Set(warningTargets(clan, members).map((m) => m.id));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), pageCount - 1);
  const slice = rows.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE);

  const recent = await db
    .select()
    .from(warningsTable)
    .where(eq(warningsTable.guildId, clan.guildId))
    .orderBy(desc(warningsTable.issuedAt))
    .limit(5);

  const filterMeta = DASH_FILTERS.find((f) => f.value === filter)!;
  const embed = new EmbedBuilder()
    .setColor(filter === "attention" && rows.length ? 0xed4245 : 0x5865f2)
    .setTitle(`⚠️ Warning Dashboard — ${clan.clanName}`)
    .setDescription(
      `**${filterMeta.emoji} ${filterMeta.label}** · ${rows.length} member(s)` +
        (pageCount > 1 ? ` · page ${clamped + 1}/${pageCount}` : "") +
        "\n\n" +
        (slice.length
          ? slice.map((m) => memberLine(clan, m, eligible.has(m.id))).join("\n")
          : "_Nobody matches this filter — nice and quiet._")
    )
    .addFields({
      name: "Recent warning activity",
      value: recent.length
        ? recent
            .map(
              (w) =>
                `${w.removedAt ? "~~" : ""}⚠️ **${w.username}** — ${w.reason.slice(0, 60)} · ${relative(w.issuedAt)}${w.removedAt ? "~~ (removed)" : ""}`
            )
            .join("\n")
        : "_No warnings issued yet._",
    })
    .setFooter({
      text: `🚨 = warning-eligible (${clan.warningThreshold}+ reminders, goal not met) · reminders & warnings count per week`,
    });

  return {
    embeds: [embed],
    components: dashboardComponents({ filter, page: clamped, pageCount }),
  };
}

async function officerGuard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction
): Promise<Clan | null> {
  if (!interaction.inCachedGuild()) return null;
  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return null;
  }
  if (!isOfficer(interaction.member, clan)) {
    await interaction.editReply({ content: "The warning dashboard is officer-only." });
    return null;
  }
  return clan;
}

/** /xp dashboard entry point. */
export async function openDashboard(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply();
  const clan = await officerGuard(interaction);
  if (!clan) return;
  await interaction.editReply(await buildDashboardPayload(clan, "attention", 0));
}

export async function handleDashButton(interaction: ButtonInteraction) {
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction);
  if (!clan) return;
  const { action, arg } = parseId(interaction.customId);
  if (action === "refresh") {
    await interaction.editReply(await buildDashboardPayload(clan, "attention", 0));
    return;
  }
  if (action === "page" && arg) {
    // arg is "<filter>-<page>"
    const sep = arg.lastIndexOf("-");
    const filter = (arg.slice(0, sep) || "attention") as DashFilter;
    const page = parseInt(arg.slice(sep + 1), 10) || 0;
    await interaction.editReply(await buildDashboardPayload(clan, filter, page));
  }
}

export async function handleDashSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction);
  if (!clan) return;
  const filter = (interaction.values[0] ?? "attention") as DashFilter;
  await interaction.editReply(await buildDashboardPayload(clan, filter, 0));
}
