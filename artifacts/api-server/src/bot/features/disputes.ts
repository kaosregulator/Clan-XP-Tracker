import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
  type Attachment,
} from "discord.js";
import type { Clan, Dispute, DisputeEvidence, DisputeType } from "@workspace/db";
import { getClan, isOfficer, updateClan } from "../services/config";
import { listActive, removeWarning } from "../services/warnings";
import {
  openDisputeTicket,
  listDisputes,
  getDispute,
  decideDisputeTicket,
  findOpenDisputeForUser,
  resendDisputeTranscript,
  deleteDisputeChannel,
  DISPUTE_TYPE_LABEL,
  parseEvidence,
  OPEN_DISPUTE_STATUSES,
  type DisputeDecision,
} from "../services/disputes";
import { relative } from "../services/time";
import { memberSummary } from "./commandCenter";
import {
  DISPUTE_REVIEW_PICK,
  disputeRemoveWarning,
  disputeMember,
  disputeTranscript,
  disputeDelete,
  parseId,
} from "../ui/ids";
import { notConfiguredMessage } from "./xp";

/**
 * XP dispute tickets.
 *
 * Members open a private channel with /dispute (native Discord attachment for
 * evidence — never a pasted URL). Staff Resolve / Reject / Close inside that
 * channel. Deciding never lifts enforcement by itself — Remove warning is
 * separate when needed.
 */

const STATUS_BADGE: Record<string, string> = {
  open: "🟡 Open",
  pending: "🟡 Open",
  info_requested: "🔵 Info requested",
  resolved: "✅ Resolved",
  accepted: "✅ Resolved",
  rejected: "❌ Rejected",
  denied: "❌ Rejected",
  closed: "🔒 Closed",
};

function evidenceFromAttachment(att: Attachment | null): DisputeEvidence[] {
  if (!att) return [];
  return [
    {
      url: att.url,
      name: att.name || "evidence",
      contentType: att.contentType ?? null,
      size: att.size ?? 0,
    },
  ];
}

/* ------------------------------------------------------------ member flow */

/**
 * Hub helper: point members at /dispute (attachments require the slash command —
 * Discord modals cannot accept file uploads).
 */
export async function buildDisputePicker(
  clan: Clan,
  userId: string
): Promise<BaseMessageOptions & { content: string }> {
  const open = await findOpenDisputeForUser(clan.guildId, userId);
  if (open?.channelId) {
    return {
      content: `You already have an open dispute — continue in <#${open.channelId}>.`,
      components: [],
    };
  }

  const warns = await listActive(clan.guildId, userId);
  const warnHint = warns.length
    ? `\n\nYour active warnings: ${warns
        .slice(0, 5)
        .map((w) => `**#${w.id}**`)
        .join(", ")} — pass \`warning_id\` when type is **warning**.`
    : "";

  if (!clan.disputeCategoryId) {
    return {
      content:
        "Disputes aren't configured on this server yet. Ask an admin to set a **Dispute category** in **/setup → Disputes**.",
      components: [],
    };
  }

  return {
    content:
      `Use **/dispute** to open a private ticket with staff.\n` +
      `• Choose a **type** (warning / XP record / role action)\n` +
      `• Write your **explanation**\n` +
      `• Optionally attach an **image from your device** with the **evidence** option` +
      ` (Discord's normal upload — no image URL)\n` +
      warnHint,
    components: [],
  };
}

/** /dispute — open a private dispute ticket with optional native attachment. */
export async function openDisputeCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });

  const clan = await getClan(interaction.guildId);
  if (!clan) {
    await interaction.editReply(notConfiguredMessage(isOfficer(interaction.member, null)));
    return;
  }

  const typeRaw = interaction.options.getString("type") ?? "warning";
  const disputeType = (
    ["warning", "xp_record", "role_action"].includes(typeRaw) ? typeRaw : "warning"
  ) as DisputeType;
  const explanation = interaction.options.getString("explanation", true);
  const warningId = interaction.options.getInteger("warning_id");
  const evidenceAtt = interaction.options.getAttachment("evidence");

  // Reject non-image attachments politely but still allow common proof formats.
  if (evidenceAtt) {
    const ct = (evidenceAtt.contentType ?? "").toLowerCase();
    const ok =
      ct.startsWith("image/") ||
      ct === "application/pdf" ||
      /\.(png|jpe?g|gif|webp|pdf)$/i.test(evidenceAtt.name ?? "");
    if (!ok) {
      await interaction.editReply({
        content:
          "Evidence must be an **image** (or PDF) uploaded from your device via the **evidence** option — not a link.",
      });
      return;
    }
  }

  const res = await openDisputeTicket({
    client: interaction.client,
    guild: interaction.guild,
    clan,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.user.displayName,
    },
    disputeType,
    reason: explanation,
    warningId,
    evidence: evidenceFromAttachment(evidenceAtt),
  });

  if (!res.ok) {
    await interaction.editReply({ content: `⚠️ ${res.error}` });
    return;
  }

  await interaction.editReply({
    content:
      `✅ Dispute **#${res.dispute.id}** opened — continue in <#${res.channelId}>.\n` +
      `Only you, configured staff, and the bot can see that channel.` +
      (evidenceAtt ? `\n📎 Evidence attached: **${evidenceAtt.name}**` : ""),
  });
}

/** @deprecated Hub used to open a modal with a URL field — redirect to /dispute. */
export async function openDisputePicker(interaction: ChatInputCommandInteraction) {
  return openDisputeCommand(interaction);
}

/** Legacy select → tell the member to use /dispute with attachment. */
export async function handleDisputePickSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.inCachedGuild()) return;
  const warningId = Number(interaction.values[0]);
  await interaction.reply({
    content:
      `To dispute warning **#${warningId}**, run:\n` +
      `**/dispute** \`type:warning\` \`warning_id:${warningId}\` \`explanation:…\` and optionally attach **evidence** from your device.\n` +
      `_No image URL needed — use Discord's normal file upload._`,
    flags: 64,
  });
}

/** Legacy modal path (proof URL) — closed; point at /dispute. */
export async function handleDisputeReasonModal(interaction: ModalSubmitInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.reply({
    content:
      "Disputes now open a private ticket channel via **/dispute**, with optional **evidence** uploaded from your device. Image URLs are no longer used.",
    flags: 64,
  });
}

/* ------------------------------------------------------------- staff flow */

async function officerGuard(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  deferred: boolean
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
    const content = "Dispute review is officer-only. Members open disputes with /dispute.";
    if (deferred) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: 64 });
    return null;
  }
  return clan;
}

function disputeLine(d: Dispute): string {
  const type = DISPUTE_TYPE_LABEL[(d.disputeType as DisputeType) || "warning"] ?? d.disputeType;
  const ch = d.channelId ? ` · <#${d.channelId}>` : "";
  return `${STATUS_BADGE[d.status] ?? d.status} · **#${d.id}** ${d.username} — ${type}${ch} · ${relative(d.createdAt)}`;
}

export async function buildDisputeReview(clan: Clan): Promise<BaseMessageOptions> {
  const open = await listDisputes(clan.guildId, "open", 25);
  const embed = new EmbedBuilder()
    .setColor(open.length ? 0xfaa61a : 0x3ba55d)
    .setTitle(`⚖️ XP Disputes — ${clan.clanName}`)
    .setDescription(
      open.length
        ? `**${open.length}** open ticket(s):\n\n${open.map(disputeLine).join("\n")}`
        : "✨ No open dispute tickets."
    )
    .setFooter({
      text: "Handle disputes inside their private channel (Resolve / Reject / Close). Removing a warning is a separate action.",
    });

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  if (open.length) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(DISPUTE_REVIEW_PICK)
          .setPlaceholder("Jump to a dispute…")
          .addOptions(
            open.slice(0, 25).map((d) => ({
              label: `#${d.id} — ${d.username}`.slice(0, 100),
              description: `${d.disputeType}${d.channelId ? " · has channel" : ""}`.slice(0, 100),
              value: String(d.id),
            }))
          )
      )
    );
  }
  return { embeds: [embed], components: rows };
}

/** /disputes — staff list of open tickets. */
export async function openDisputeReview(interaction: ChatInputCommandInteraction) {
  if (!interaction.inCachedGuild()) return;
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildDisputeReview(clan));
}

export async function openDisputeReviewFromButton(interaction: ButtonInteraction) {
  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  await interaction.editReply(await buildDisputeReview(clan));
}

export async function handleDisputeReviewSelect(interaction: StringSelectMenuInteraction) {
  await interaction.deferUpdate();
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const id = Number(interaction.values[0]);
  const d = id ? await getDispute(clan.guildId, id) : null;
  if (!d) {
    await interaction.followUp({ content: "That dispute no longer exists.", flags: 64 });
    return;
  }
  const evidence = parseEvidence(d.evidenceJson);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⚖️ Dispute #${d.id} — ${d.username}`)
    .setDescription(d.reason.slice(0, 4000))
    .addFields(
      { name: "Status", value: STATUS_BADGE[d.status] ?? d.status, inline: true },
      { name: "Type", value: d.disputeType, inline: true },
      {
        name: "Channel",
        value: d.channelId ? `<#${d.channelId}>` : "_none_",
        inline: true,
      },
      ...(evidence.length
        ? [
            {
              name: "Evidence",
              value: evidence.map((e) => `[${e.name}](${e.url})`).join("\n").slice(0, 1024),
            },
          ]
        : [])
    );

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(disputeRemoveWarning(d.id))
        .setLabel("Remove linked warning")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!d.warningId),
      new ButtonBuilder()
        .setCustomId(disputeMember(d.userId))
        .setLabel("View member")
        .setStyle(ButtonStyle.Primary)
    ),
  ];

  await interaction.followUp({
    content: d.channelId
      ? `Open <#${d.channelId}> to Resolve / Reject / Close.`
      : "This dispute has no channel — use the buttons below if needed.",
    embeds: [embed],
    components: rows,
    flags: 64,
  });
}

export async function handleDisputeSelect(interaction: StringSelectMenuInteraction) {
  const { action } = parseId(interaction.customId);
  if (action === "pick") return void (await handleDisputePickSelect(interaction));
  if (action === "review") return void (await handleDisputeReviewSelect(interaction));
}

export async function handleDisputeButton(interaction: ButtonInteraction) {
  const { action, arg } = parseId(interaction.customId);

  if (action === "member") {
    await interaction.deferReply({ flags: 64 });
    const clan = await officerGuard(interaction, true);
    if (!clan) return;
    await interaction.editReply(await memberSummary(clan, String(arg)));
    return;
  }

  await interaction.deferReply({ flags: 64 });
  const clan = await officerGuard(interaction, true);
  if (!clan) return;
  const did = Number(arg);
  const d = did ? await getDispute(clan.guildId, did) : null;
  if (!d) {
    await interaction.editReply({ content: "That dispute no longer exists." });
    return;
  }
  const staff = { id: interaction.user.id, username: interaction.user.username };

  if (action === "resolve" || action === "reject" || action === "close" || action === "accept" || action === "deny") {
    const decision: DisputeDecision =
      action === "resolve" || action === "accept"
        ? "resolved"
        : action === "reject" || action === "deny"
          ? "rejected"
          : "closed";

    if (!OPEN_DISPUTE_STATUSES.includes(d.status as (typeof OPEN_DISPUTE_STATUSES)[number])) {
      await interaction.editReply({
        content: `Dispute #${did} is already **${d.status}**. Use **Transcript** or **Delete** on the ticket.`,
      });
      return;
    }

    try {
      const res = await decideDisputeTicket({
        client: interaction.client,
        guild: interaction.guild!,
        clan,
        disputeId: did,
        decision,
        staffId: staff.id,
        staffUsername: staff.username,
      });

      const label = decision === "resolved" ? "resolved" : decision === "rejected" ? "rejected" : "closed";
      await interaction.editReply({
        content:
          `⚖️ Dispute **#${did}** ${label}.` +
          (res?.transcriptPosted
            ? " Full transcript posted to the staff log channel."
            : " _(No log channel configured — transcript was still captured into audit details when possible.)_") +
          (res?.channelLocked
            ? " Channel locked — use **Transcript** / **Delete** when ready. The channel was not deleted."
            : "") +
          (decision === "resolved" && d.warningId
            ? "\n_Tip: use **Remove linked warning** from `/disputes` if enforcement should be lifted._"
            : ""),
      });
      // Swap the opener message buttons to Transcript / Delete when editable.
      if (interaction.message.editable) {
        await interaction.message
          .edit({
            components: [
              new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
                new ButtonBuilder()
                  .setCustomId(disputeTranscript(did))
                  .setLabel("Transcript")
                  .setEmoji("📄")
                  .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                  .setCustomId(disputeDelete(did))
                  .setLabel("Delete")
                  .setEmoji("🗑️")
                  .setStyle(ButtonStyle.Danger)
              ),
            ],
          })
          .catch(() => {});
      }
    } catch (err) {
      await interaction.editReply({
        content: `⚠️ ${err instanceof Error ? err.message : "Could not close the dispute."}`,
      });
    }
    return;
  }

  if (action === "transcript") {
    const res = await resendDisputeTranscript({
      client: interaction.client,
      guild: interaction.guild!,
      clan,
      disputeId: did,
      staffId: staff.id,
      staffUsername: staff.username,
    });
    await interaction.editReply({
      content: res.ok
        ? `📄 Transcript for dispute **#${did}** posted to the staff log channel.`
        : `⚠️ ${res.error}`,
    });
    return;
  }

  if (action === "delete") {
    const res = await deleteDisputeChannel({
      client: interaction.client,
      guild: interaction.guild!,
      clan,
      disputeId: did,
      staffId: staff.id,
      staffUsername: staff.username,
    });
    await interaction.editReply({
      content: res.ok
        ? `🗑️ Dispute **#${did}** channel deleted. Final transcript saved/updated in the staff log.`
        : `⚠️ ${res.error}`,
    });
    return;
  }

  if (action === "remwarn") {
    if (!d.warningId) {
      await interaction.editReply({ content: "This dispute isn't linked to a warning." });
      return;
    }
    const removed = await removeWarning({
      guild: interaction.guild!,
      clan,
      warningId: d.warningId,
      moderatorId: staff.id,
      moderatorUsername: staff.username,
    });
    if (OPEN_DISPUTE_STATUSES.includes(d.status as (typeof OPEN_DISPUTE_STATUSES)[number])) {
      try {
        await decideDisputeTicket({
          client: interaction.client,
          guild: interaction.guild!,
          clan,
          disputeId: did,
          decision: "resolved",
          staffId: staff.id,
          staffUsername: staff.username,
          note: "Warning removed.",
        });
      } catch {
        // Warning was removed; transcript failure shouldn't undo that.
      }
    }
    await interaction.editReply({
      content: removed
        ? `✅ Removed warning #${d.warningId} and resolved dispute #${did}.`
        : `Warning #${d.warningId} was already removed; dispute #${did} marked resolved.`,
    });
    return;
  }

  if (action === "info" || action === "ticket") {
    await interaction.editReply({
      content:
        "Ask for more info or continue the conversation **inside the private dispute channel**. " +
        "Use **Resolve / Reject / Close** when you're done (that saves a transcript). " +
        "Then **Transcript** / **Delete** as needed.",
    });
  }
}

/** Re-export for setup's "create category" action. */
export { updateClan };
