import {
  db,
  dashboardsTable,
  warningsTable,
  auditLogsTable,
  type Clan,
} from "@workspace/db";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type BaseMessageOptions,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { PALETTE } from "../canvas/theme";
import { logger } from "../../lib/logger";
import { getClan } from "./config";
import {
  listTracked,
  snapshotFrom,
  reminderTargets,
  warningTargets,
  type WeeklySnapshot,
} from "./progress";
import { membersMissingToday } from "./xpLedger";
import { weekKey, weekRangeLabel, discordRelative, relative, nextWeeklyReset } from "./time";
import {
  CC_REFRESH,
  CC_MANAGE,
  CC_WARNINGS,
  CC_NOTIFS,
  CC_REPORTS,
  CC_CALENDAR,
  CC_SEARCH,
  ccCategory,
} from "../ui/ids";

/**
 * The persistent live XP Command Center. One durable Discord message per guild
 * (dashboards row, type "staff") that surfaces the actionable state of the
 * whole roster — counts first — and routes staff into the existing hubs. It is
 * refreshed in place, on a debounce, whenever the data behind it changes.
 */

const DASH_TYPE = "staff";

/* ----------------------------------------------------------- persistence */

export interface StaffDashboard {
  guildId: string;
  channelId: string;
  messageId: string | null;
}

export async function getStaffDashboard(guildId: string): Promise<StaffDashboard | null> {
  const [row] = await db
    .select()
    .from(dashboardsTable)
    .where(and(eq(dashboardsTable.guildId, guildId), eq(dashboardsTable.type, DASH_TYPE)));
  return row ? { guildId: row.guildId, channelId: row.channelId, messageId: row.messageId } : null;
}

/** Remember where the live command center lives so it can be edited later. */
export async function saveStaffDashboard(
  guildId: string,
  channelId: string,
  messageId: string
): Promise<void> {
  await db
    .insert(dashboardsTable)
    .values({ guildId, type: DASH_TYPE, channelId, messageId })
    .onConflictDoUpdate({
      target: [dashboardsTable.guildId, dashboardsTable.type],
      set: { channelId, messageId, updatedAt: new Date() },
    });
}

/** Forget the stored message id (e.g. after it was deleted). */
async function clearStaffMessage(guildId: string): Promise<void> {
  await db
    .update(dashboardsTable)
    .set({ messageId: null })
    .where(and(eq(dashboardsTable.guildId, guildId), eq(dashboardsTable.type, DASH_TYPE)));
}

/* ------------------------------------------------------------------ stats */

export interface CommandCenterStats {
  snap: WeeklySnapshot;
  attention: number; // still short of goal, active (remind-eligible)
  warnable: number; // warning-eligible this week
  reminded: number; // reminded at least once this week
  warned: number; // warned at least once this week
  missedToday: number; // haven't met today's daily target
  activeWarnings: number; // open warning rows across the guild
  recent: { line: string }[];
}

/** Everything the command center renders, composed from the existing services. */
export async function commandCenterStats(clan: Clan): Promise<CommandCenterStats> {
  const wk = weekKey(clan);
  const members = await listTracked(clan);
  const snap = snapshotFrom(clan, members);
  const attention = reminderTargets(clan, members).length;
  const warnable = warningTargets(clan, members).length;
  const reminded = members.filter((m) => m.weekKey === wk && m.weekReminders > 0).length;
  const warned = members.filter((m) => m.weekKey === wk && m.weekWarnings > 0).length;
  const missing = await membersMissingToday(clan, members);

  const [{ count: activeWarnings = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(warningsTable)
    .where(and(eq(warningsTable.guildId, clan.guildId), isNull(warningsTable.removedAt)));

  const recentRows = await db
    .select()
    .from(auditLogsTable)
    .where(eq(auditLogsTable.guildId, clan.guildId))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(6);

  const recent = recentRows.map((r) => ({ line: `${auditIcon(r.action)} ${auditLabel(r)} · ${relative(r.createdAt)}` }));

  return {
    snap,
    attention,
    warnable,
    reminded,
    warned,
    missedToday: missing.length,
    activeWarnings,
    recent,
  };
}

function auditIcon(action: string): string {
  if (action.startsWith("warning_issued")) return "⚠️";
  if (action.startsWith("warning_removed")) return "✅";
  if (action.startsWith("reminder")) return "🔔";
  if (action.startsWith("week_reset")) return "📅";
  if (action.startsWith("exempt")) return "🛡️";
  if (action.startsWith("onLeave")) return "🌙";
  if (action.startsWith("xp_entry") || action.startsWith("xp_")) return "📒";
  return "•";
}

function auditLabel(r: {
  action: string;
  targetUsername: string | null;
  moderatorUsername: string | null;
}): string {
  const who = r.targetUsername ? `**${r.targetUsername}**` : "";
  const by = r.moderatorUsername ? ` by ${r.moderatorUsername}` : "";
  const verb: Record<string, string> = {
    warning_issued: "warned",
    warning_removed: "warning removed",
    reminder_sent: "reminded",
    week_reset: "week archived & reset",
    exempt_set: "marked exempt",
    exempt_cleared: "exempt cleared",
    onLeave_set: "marked on leave",
    onLeave_cleared: "back from leave",
    xp_entry: "XP logged",
    xp_add: "XP added",
    xp_set: "XP set",
    xp_remove: "XP removed",
    xp_complete: "marked complete",
    xp_reset: "progress reset",
    note_set: "note updated",
    goal_override_set: "goal override set",
  };
  const label = verb[r.action] ?? r.action.replace(/_/g, " ");
  return who ? `${who} — ${label}${by}` : `${label}${by}`;
}

/* ---------------------------------------------------------------- payload */

function bar(pct: number, width = 14): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

/** Build the live command-center message (embed + navigation controls). */
export async function buildCommandCenterPayload(clan: Clan): Promise<BaseMessageOptions> {
  const s = await commandCenterStats(clan);
  const pct = Math.round(s.snap.completionRate * 100);
  const needsAction = s.attention + s.warnable + s.missedToday + s.activeWarnings > 0;

  const embed = new EmbedBuilder()
    .setColor(needsAction ? parseInt(PALETTE.amber.slice(1), 16) : parseInt(PALETTE.green.slice(1), 16))
    .setTitle(`🛰️ XP Command Center — ${clan.clanName}`)
    .setDescription(
      `Week **${weekRangeLabel(s.snap.weekKey)}** · resets ${discordRelative(nextWeeklyReset(clan))}\n` +
        `\`${bar(pct)}\` **${pct}%** complete — ${s.snap.completed}/${s.snap.active} active members\n` +
        (needsAction
          ? `\n🚩 **Needs action:** ` +
            [
              s.attention ? `${s.attention} attention` : null,
              s.missedToday ? `${s.missedToday} missed today` : null,
              s.warnable ? `${s.warnable} warn-eligible` : null,
              s.activeWarnings ? `${s.activeWarnings} active warning(s)` : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : `\n✨ All clear — everyone tracked is on pace.`)
    )
    .addFields(
      { name: "👥 Tracked", value: `**${s.snap.tracked}**`, inline: true },
      { name: "✅ Complete", value: `**${s.snap.completed}**`, inline: true },
      { name: "🔴 Attention", value: `**${s.attention}**`, inline: true },
      { name: "🕐 Missed today", value: `**${s.missedToday}**`, inline: true },
      { name: "🔔 Reminded", value: `**${s.reminded}**`, inline: true },
      { name: "⚠️ Warnings", value: `**${s.activeWarnings}** open · ${s.warned} this wk`, inline: true },
      { name: "🛡️ Exempt", value: `**${s.snap.exempt}**`, inline: true },
      { name: "🌙 On leave", value: `**${s.snap.onLeave}**`, inline: true },
      { name: "🚨 Warn-eligible", value: `**${s.warnable}**`, inline: true },
      {
        name: "🧾 Recent activity",
        value: s.recent.length ? s.recent.map((r) => r.line).join("\n") : "_Nothing logged yet._",
        inline: false,
      }
    )
    .setFooter({ text: "Live dashboard · refreshes automatically when data changes" })
    .setTimestamp();

  const b = (cid: string, label: string, style = ButtonStyle.Secondary, disabled = false) =>
    new ButtonBuilder().setCustomId(cid).setLabel(label).setStyle(style).setDisabled(disabled);

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    // Category shortcuts — jump straight into the filtered roster.
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(CC_MANAGE, "📋 Manage XP", ButtonStyle.Primary),
      b(ccCategory("attention"), `🔴 Attention${s.attention ? ` (${s.attention})` : ""}`, s.attention ? ButtonStyle.Danger : ButtonStyle.Secondary, s.attention === 0 && s.snap.tracked === 0),
      b(ccCategory("missed"), `🕐 Missed${s.missedToday ? ` (${s.missedToday})` : ""}`, ButtonStyle.Secondary, s.missedToday === 0),
      b(CC_WARNINGS, `⚠️ Warnings${s.activeWarnings ? ` (${s.activeWarnings})` : ""}`, s.activeWarnings ? ButtonStyle.Danger : ButtonStyle.Secondary)
    ),
    // Hubs.
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(CC_NOTIFS, `🔔 Notifications${needsAction ? " •" : ""}`, ButtonStyle.Primary),
      b(CC_REPORTS, "📊 Reports"),
      b(CC_CALENDAR, "📅 Calendar"),
      b(CC_SEARCH, "🔎 Search")
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      b(CC_REFRESH, "🔄 Refresh")
    ),
  ];

  return { embeds: [embed], components: rows };
}

/* ------------------------------------------------------- posting & refresh */

let dashboardClient: Client | null = null;

/** Wire the live client in once the bot is ready (called from bot boot). */
export function setCommandCenterClient(client: Client): void {
  dashboardClient = client;
}

/**
 * Post a brand-new command center message in `channelId` and remember it. Any
 * previously tracked message is left in place (staff can delete it) — the new
 * one becomes the live target.
 */
export async function postCommandCenter(clan: Clan, channelId: string): Promise<string | null> {
  const client = dashboardClient;
  if (!client) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !("send" in channel)) return null;
    const payload = await buildCommandCenterPayload(clan);
    const msg = await channel.send(payload);
    await saveStaffDashboard(clan.guildId, channelId, msg.id);
    return msg.id;
  } catch (err) {
    logger.warn({ err, guild: clan.guildId, channelId }, "Failed to post command center");
    return null;
  }
}

/** Edit the stored command center message in place. Best-effort. */
async function doRefresh(guildId: string): Promise<void> {
  const client = dashboardClient;
  if (!client) return;
  const state = await getStaffDashboard(guildId);
  if (!state?.messageId) return;
  const clan = await getClan(guildId);
  if (!clan) return;
  try {
    const channel = await client.channels.fetch(state.channelId);
    if (!channel?.isTextBased() || !("messages" in channel)) return;
    const payload = await buildCommandCenterPayload(clan);
    await channel.messages.edit(state.messageId, payload);
    await db
      .update(dashboardsTable)
      .set({ updatedAt: new Date() })
      .where(and(eq(dashboardsTable.guildId, guildId), eq(dashboardsTable.type, DASH_TYPE)));
  } catch (err: unknown) {
    // 10008 = Unknown Message — it was deleted. Drop the id so we stop trying.
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 10008) {
      await clearStaffMessage(guildId).catch(() => {});
      return;
    }
    logger.warn({ err, guild: guildId }, "Command center refresh failed");
  }
}

/*
 * Debounced, coalescing refresh. Many events can land in a burst (a bulk warn
 * touches dozens of members); we edit the message at most once per window and
 * never let a continuously-busy guild starve — a pending refresh always fires
 * within MAX_WAIT_MS.
 */
const DEBOUNCE_MS = 4_000;
const MAX_WAIT_MS = 20_000;

interface Pending {
  timer: NodeJS.Timeout;
  firstScheduled: number;
  running: boolean;
}
const pending = new Map<string, Pending>();

async function flush(guildId: string): Promise<void> {
  const entry = pending.get(guildId);
  if (entry?.running) return; // let the in-flight run pick up the latest state
  pending.delete(guildId);
  await doRefresh(guildId).catch(() => {});
}

/**
 * Ask the live command center for `guildId` to refresh soon. Cheap to call
 * from any write path — it coalesces bursts and no-ops when no dashboard is
 * posted (the edit simply finds no message id).
 */
export function scheduleDashboardRefresh(guildId: string): void {
  if (!dashboardClient) return;
  const now = Date.now();
  const existing = pending.get(guildId);
  if (existing) {
    // Honour the max-wait cap: don't keep pushing the refresh out forever.
    if (now - existing.firstScheduled >= MAX_WAIT_MS) return;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => void flush(guildId), DEBOUNCE_MS);
    return;
  }
  pending.set(guildId, {
    firstScheduled: now,
    running: false,
    timer: setTimeout(() => void flush(guildId), DEBOUNCE_MS),
  });
}

/** Force an immediate refresh (used by the Refresh button / scheduler). */
export async function refreshDashboardNow(guildId: string): Promise<void> {
  const existing = pending.get(guildId);
  if (existing) {
    clearTimeout(existing.timer);
    pending.delete(guildId);
  }
  await doRefresh(guildId);
}
