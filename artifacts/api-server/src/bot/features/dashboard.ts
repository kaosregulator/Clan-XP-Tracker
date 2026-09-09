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
 * Warning Dashboard — touched-up enforcement overview (same bones, cleaner
 * layout). Shows lifetime warning history in the roster and a tidy activity
 * feed. Officers open this via /warnings (no target).
 */

const PAGE_SIZE = 10;

function filterMembers(clan: Clan, members: ClanMember[], filter: DashFilter): ClanMember[] {
  const wk = weekKey(clan);
  switch (filter) {
    case "all":
      return members;
    case "complete":
      return members.filter((m) => statusOf(clan, m) === "complete");
    case "attention": {
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
    case "clean":
      return members
        .filter((m) => !m.exempt && !m.onLeave && (m.lifetimeWarnings ?? 0) === 0)
        .sort((a, b) => b.cleanPoints - a.cleanPoints);
  }
}

function memberLine(clan: Clan, m: ClanMember, warnEligible: boolean): string {
  const wk = weekKey(clan);
  const reminders = m.weekKey === wk ? m.weekReminders : 0;
  const weekWarns = m.weekKey === wk ? m.weekWarnings : 0;
  const status = statusOf(clan, m);
  const badge =
    status === "exempt"
      ? "🛡"
      : status === "leave"
        ? "🌙"
        : warnEligible
          ? "🚨"
          : reminders > 0
            ? "🔔"
            : status === "complete"
              ? "✅"
              : "·";

  const bits: string[] = [`${badge} <@${m.userId}>`, formatProgress(clan, m)];
  if (reminders) bits.push(`🔔${reminders}`);
  if (weekWarns) bits.push(`⚠️${weekWarns} this week`);
  const life = m.lifetimeWarnings ?? 0;
  if (life > 0) bits.push(`hist ${life}`);
  else bits.push("clean");
  if (m.cleanPoints > 0) bits.push(`${m.cleanPoints} pts`);
  if (m.gameUsername) bits.push(`RBX ${m.gameUsername}`);
  if (m.notes) bits.push("📝");
  return bits.join(" · ");
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
    .limit(6);

  const wk = weekKey(clan);
  const attentionN = reminderTargets(clan, members).length;
  const warnEligN = warningTargets(clan, members).length;
  const warnedWeek = members.filter((m) => m.weekKey === wk && m.weekWarnings > 0).length;
  const cleanN = members.filter(
    (m) => !m.exempt && !m.onLeave && (m.lifetimeWarnings ?? 0) === 0
  ).length;

  const filterMeta = DASH_FILTERS.find((f) => f.value === filter)!;
  const embed = new EmbedBuilder()
    .setColor(filter === "attention" && rows.length ? 0xed4245 : 0x2b2d31)
    .setTitle(`${clan.clanName} · Clan manager`)
    .setDescription(
      [
        `**${filterMeta.label}** · ${rows.length} shown` +
          (pageCount > 1 ? ` · page ${clamped + 1}/${pageCount}` : ""),
        "",
        slice.length
          ? slice.map((m) => memberLine(clan, m, eligible.has(m.id))).join("\n")
          : "_Nobody matches this filter._",
      ].join("\n")
    )
    .addFields(
      {
        name: "At a glance",
        value: [
          `Needs attention **${attentionN}**`,
          `Warning-eligible **${warnEligN}**`,
          `Warned this week **${warnedWeek}**`,
          `Never warned **${cleanN}**`,
        ].join(" · "),
        inline: false,
      },
      {
        name: "Recent warning history",
        value: recent.length
          ? recent
              .map((w) => {
                const mark = w.removedAt ? "removed" : "active";
                const name = w.username;
                return `\`${mark}\` **${name}** — ${w.reason.slice(0, 50)} · ${relative(w.issuedAt)}`;
              })
              .join("\n")
          : "_No warnings issued yet._",
      }
    )
    .setFooter({
      text: `hist = lifetime warnings (kept after remove) · clean pts via /leaderboard · link faces with /link · threshold ${clan.warningThreshold}+ reminders`,
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

/** Legacy /xp dashboard entry — still works; prefer /warnings. */
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
