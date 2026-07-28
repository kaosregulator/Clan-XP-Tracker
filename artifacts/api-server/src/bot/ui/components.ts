import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import {
  REVIEW_REMIND,
  REVIEW_WARN,
  REVIEW_EXPORT,
  REVIEW_REFRESH,
  REVIEW_RESET_WEEK,
  DASH_REFRESH,
  DASH_FILTER,
  dashPage,
} from "./ids";

export type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

export function row(...components: MessageActionRowComponentBuilder[]): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...components,
  );
}

/**
 * Action rows under the weekly review card — the officer's one-stop panel:
 * remind everyone behind, escalate to warnings, export, refresh, reset.
 */
export function reviewComponents(opts: {
  remindable: number;
  warnable: number;
}): Row[] {
  return [
    row(
      new ButtonBuilder()
        .setCustomId(REVIEW_REMIND)
        .setStyle(ButtonStyle.Primary)
        .setLabel(`Send Reminders (${opts.remindable})`)
        .setDisabled(opts.remindable === 0),
      new ButtonBuilder()
        .setCustomId(REVIEW_WARN)
        .setStyle(ButtonStyle.Danger)
        .setLabel(`Issue Warnings (${opts.warnable})`)
        .setDisabled(opts.warnable === 0),
      new ButtonBuilder()
        .setCustomId(REVIEW_EXPORT)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Export Report"),
      new ButtonBuilder()
        .setCustomId(REVIEW_REFRESH)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Refresh"),
    ),
    row(
      new ButtonBuilder()
        .setCustomId(REVIEW_RESET_WEEK)
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Reset Week (archive)"),
    ),
  ];
}

export const DASH_FILTERS = [
  { value: "attention", label: "Needs attention", emoji: "🔴" },
  { value: "reminded", label: "Reminded this week", emoji: "🔔" },
  { value: "warned", label: "Warned this week", emoji: "⚠️" },
  { value: "exempt", label: "Exempt", emoji: "🛡️" },
  { value: "leave", label: "On leave", emoji: "🌙" },
] as const;

export type DashFilter = (typeof DASH_FILTERS)[number]["value"];

/** Filter + pagination rows for the warning dashboard. */
export function dashboardComponents(opts: {
  filter: DashFilter;
  page: number;
  pageCount: number;
}): Row[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId(DASH_FILTER)
    .setPlaceholder("Filter members…")
    .addOptions(
      DASH_FILTERS.map((f) => ({
        value: f.value,
        label: f.label,
        emoji: f.emoji,
        default: f.value === opts.filter,
      })),
    );
  const rows: Row[] = [row(select)];
  const nav: ButtonBuilder[] = [];
  if (opts.pageCount > 1) {
    nav.push(
      new ButtonBuilder()
        .setCustomId(dashPage(opts.filter, opts.page - 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("◀ Prev")
        .setDisabled(opts.page <= 0),
      new ButtonBuilder()
        .setCustomId(dashPage(opts.filter, opts.page + 1))
        .setStyle(ButtonStyle.Secondary)
        .setLabel("Next ▶")
        .setDisabled(opts.page >= opts.pageCount - 1),
    );
  }
  nav.push(
    new ButtonBuilder()
      .setCustomId(DASH_REFRESH)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("Refresh"),
  );
  rows.push(row(...nav));
  return rows;
}
