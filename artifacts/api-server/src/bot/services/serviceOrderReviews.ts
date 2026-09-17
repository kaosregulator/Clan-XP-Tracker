/**
 * Post-completion leveling service review flow.
 * Prompt in DM + ticket (fallback), star ratings, optional before/after photos,
 * then a public review card in the configured reviews channel.
 */
import {
  db,
  serviceOrdersTable,
  serviceOrderReviewsTable,
  type Clan,
  type ServiceOrder,
  type ServiceOrderAttachment,
  type ServiceOrderReview,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import { getMember } from "./config";
import { staffLog } from "./logging";
import { logger } from "../../lib/logger";
import { renderOffThread } from "../canvas/render-pool";
import {
  parseAttachmentsJson,
  serializeAttachments,
  starBar,
  isImageAttachment,
  SERVICE_ORDER_MAX_PHOTOS,
  SERVICE_ORDER_MIN_PHOTOS,
} from "./serviceOrderHelpers";
import {
  svcReviewStart,
  svcReviewSpeed,
  svcReviewQuality,
  svcReviewRecommend,
  svcReviewPhotos,
  svcReviewSkipPhotos,
  svcReviewCommentModal,
  parseId,
} from "../ui/ids";

/** In-memory draft while the customer walks through the review form. */
interface ReviewDraft {
  orderId: number;
  guildId: string;
  speed?: number;
  quality?: number;
  wouldRecommend?: boolean;
  comment?: string | null;
  photos?: ServiceOrderAttachment[];
  updatedAt: number;
}

const drafts = new Map<string, ReviewDraft>();
const DRAFT_TTL_MS = 60 * 60 * 1000;

function draftKey(guildId: string, orderId: number, userId: string): string {
  return `${guildId}:${orderId}:${userId}`;
}

function getDraft(guildId: string, orderId: number, userId: string): ReviewDraft {
  const key = draftKey(guildId, orderId, userId);
  const existing = drafts.get(key);
  if (existing && Date.now() - existing.updatedAt < DRAFT_TTL_MS) return existing;
  const fresh: ReviewDraft = { orderId, guildId, updatedAt: Date.now() };
  drafts.set(key, fresh);
  return fresh;
}

function saveDraft(userId: string, draft: ReviewDraft): void {
  draft.updatedAt = Date.now();
  drafts.set(draftKey(draft.guildId, draft.orderId, userId), draft);
}

function clearDraft(guildId: string, orderId: number, userId: string): void {
  drafts.delete(draftKey(guildId, orderId, userId));
}

function starRow(
  orderId: number,
  kind: "speed" | "quality",
  selected?: number
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const mk = kind === "speed" ? svcReviewSpeed : svcReviewQuality;
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    ...([1, 2, 3, 4, 5] as const).map((n) =>
      new ButtonBuilder()
        .setCustomId(mk(orderId, n))
        .setLabel(selected === n ? `★ ${n}` : `${n}`)
        .setStyle(selected === n ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
}

export function reviewIntroPayload(order: ServiceOrder): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`⭐ Leave a review · ${order.publicId}`)
        .setDescription(
          `Thanks for using the leveling service!\n\n` +
            `Please rate **${order.serviceLabel}**` +
            (order.staffUsername ? ` completed by **${order.staffUsername}**` : "") +
            `.\n\nYou'll rate speed, quality, and whether you'd recommend us. ` +
            `You can attach before/after photos for the public review card.`
        )
        .setFooter({ text: "Your review helps the leveling team improve." }),
    ],
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(svcReviewStart(order.id))
          .setLabel("Leave a review")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Primary)
      ),
    ],
  };
}

/** DM + ticket prompt after complete. Always tries DM even if ticket is gone. */
export async function promptServiceOrderReview(opts: {
  client: Client;
  clan: Clan;
  order: ServiceOrder;
}): Promise<void> {
  const { client, clan, order } = opts;
  if (order.status !== "completed") return;
  if (order.reviewSubmittedAt) return;

  await db
    .update(serviceOrdersTable)
    .set({ reviewPromptedAt: new Date() })
    .where(eq(serviceOrdersTable.id, order.id));

  const payload = reviewIntroPayload(order);

  try {
    const user = await client.users.fetch(order.customerId);
    await user.send(payload);
  } catch {
    /* DMs closed — ticket fallback below */
  }

  if (order.channelId) {
    try {
      const ch = await client.channels.fetch(order.channelId);
      if (ch?.isTextBased() && ch.isSendable()) {
        await ch.send({
          content: `<@${order.customerId}> — before this ticket is deleted, please leave a quick review:`,
          ...payload,
          allowedMentions: { users: [order.customerId] },
        });
      }
    } catch {
      /* channel may already be gone */
    }
  }
}

async function resolveAvatars(
  client: Client,
  clan: Clan,
  order: ServiceOrder
): Promise<{
  customerAvatar: string | null;
  customerRoblox: string | null;
  staffAvatar: string | null;
  staffRoblox: string | null;
  staffDisplay: string | null;
}> {
  const customerMember = await getMember(clan.guildId, order.customerId);
  const customerUser = await client.users.fetch(order.customerId).catch(() => null);
  const customerDiscord =
    customerUser?.displayAvatarURL({ size: 256, extension: "png" }) ??
    customerMember?.avatarUrl ??
    null;

  let staffAvatar: string | null = null;
  let staffRoblox: string | null = null;
  let staffDisplay = order.staffUsername;
  if (order.staffId) {
    const staffMember = await getMember(clan.guildId, order.staffId);
    const staffUser = await client.users.fetch(order.staffId).catch(() => null);
    staffAvatar =
      staffUser?.displayAvatarURL({ size: 256, extension: "png" }) ??
      staffMember?.avatarUrl ??
      null;
    staffRoblox = staffMember?.robloxAvatarUrl ?? null;
    staffDisplay =
      staffMember?.displayName || staffUser?.displayName || order.staffUsername;
  }

  return {
    customerAvatar: customerMember?.robloxAvatarUrl || customerDiscord,
    customerRoblox: customerMember?.robloxAvatarUrl ?? null,
    staffAvatar: staffRoblox || staffAvatar,
    staffRoblox,
    staffDisplay: staffDisplay ?? null,
  };
}

async function publishReview(opts: {
  client: Client;
  clan: Clan;
  order: ServiceOrder;
  draft: ReviewDraft;
  actorId: string;
}): Promise<{ ok: true; review: ServiceOrderReview } | { ok: false; error: string }> {
  const { client, clan, order, draft } = opts;
  if (draft.speed == null || draft.quality == null || draft.wouldRecommend == null) {
    return { ok: false, error: "Please finish all rating steps first." };
  }

  const existing = await db
    .select()
    .from(serviceOrderReviewsTable)
    .where(eq(serviceOrderReviewsTable.orderId, order.id))
    .limit(1);
  if (existing[0]) {
    return { ok: false, error: "You already left a review for this order." };
  }

  const photos = (draft.photos ?? []).slice(0, SERVICE_ORDER_MAX_PHOTOS);
  const avatars = await resolveAvatars(client, clan, order);
  const started = order.createdAt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const completed = (order.completedAt ?? new Date()).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  let cardFile: AttachmentBuilder | undefined;
  try {
    const png = await renderOffThread("serviceOrderReviewCard", {
      communityName: clan.clanName,
      publicId: order.publicId,
      serviceLabel: order.serviceLabel,
      customerName: order.customerDisplayName,
      customerHandle: order.customerUsername,
      customerAvatarUrl: avatars.customerAvatar,
      staffName: avatars.staffDisplay,
      staffAvatarUrl: avatars.staffAvatar,
      speedRating: draft.speed,
      qualityRating: draft.quality,
      wouldRecommend: draft.wouldRecommend,
      comment: draft.comment ?? null,
      startedAt: started,
      completedAt: completed,
      photoUrls: photos.map((p) => p.url),
    });
    cardFile = new AttachmentBuilder(png, { name: `review-${order.publicId}.png` });
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "serviceOrderReviewCard render failed");
  }

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`⭐ Review · ${order.publicId}`)
    .setDescription(
      `**${order.customerDisplayName}** reviewed **${order.serviceLabel}**` +
        (avatars.staffDisplay ? ` · by **${avatars.staffDisplay}**` : "")
    )
    .addFields(
      { name: "Speed", value: starBar(draft.speed), inline: true },
      { name: "Quality", value: starBar(draft.quality), inline: true },
      {
        name: "Recommend?",
        value: draft.wouldRecommend ? "✅ Yes" : "❌ No",
        inline: true,
      },
      { name: "Started", value: started, inline: true },
      { name: "Completed", value: completed, inline: true },
      ...(draft.comment
        ? [{ name: "Comment", value: draft.comment.slice(0, 1024) }]
        : [])
    )
    .setTimestamp();

  if (cardFile) embed.setImage(`attachment://review-${order.publicId}.png`);
  if (avatars.customerAvatar) embed.setThumbnail(avatars.customerAvatar);

  let reviewChannelId: string | null = clan.serviceOrderReviewChannelId ?? null;
  let reviewMessageId: string | null = null;

  if (reviewChannelId) {
    try {
      const ch = await client.channels.fetch(reviewChannelId);
      if (ch?.isTextBased() && ch.isSendable()) {
        const msg = await ch.send({
          embeds: [embed],
          files: [
            ...(cardFile ? [cardFile] : []),
            ...photos.slice(0, 4).map((p) => ({
              attachment: p.url,
              name: p.name || "review-photo.png",
            })),
          ],
        });
        reviewMessageId = msg.id;
      }
    } catch (err) {
      logger.warn({ err, reviewChannelId }, "Failed to post leveling review card");
    }
  }

  const [review] = await db
    .insert(serviceOrderReviewsTable)
    .values({
      guildId: clan.guildId,
      orderId: order.id,
      publicId: order.publicId,
      customerId: order.customerId,
      customerUsername: order.customerUsername,
      customerDisplayName: order.customerDisplayName,
      staffId: order.staffId,
      staffUsername: order.staffUsername,
      serviceKey: order.serviceKey,
      serviceLabel: order.serviceLabel,
      speedRating: draft.speed,
      qualityRating: draft.quality,
      wouldRecommend: draft.wouldRecommend,
      comment: draft.comment ?? null,
      photosJson: serializeAttachments(photos),
      photoCount: photos.length,
      reviewChannelId,
      reviewMessageId,
      orderCreatedAt: order.createdAt,
      orderCompletedAt: order.completedAt,
    })
    .returning();

  await db
    .update(serviceOrdersTable)
    .set({ reviewSubmittedAt: new Date() })
    .where(eq(serviceOrdersTable.id, order.id));

  await staffLog({
    client,
    clan,
    action: "service_order_review_submitted",
    title: `⭐ Review submitted · ${order.publicId}`,
    description: `<@${order.customerId}> left a review` +
      (reviewChannelId ? ` → <#${reviewChannelId}>` : " (no review channel set)"),
    color: 0xf1c40f,
    actorId: order.customerId,
    actorUsername: order.customerUsername,
    targetUserId: order.staffId,
    targetUsername: order.staffUsername,
    fields: [
      { name: "Speed", value: starBar(draft.speed), inline: true },
      { name: "Quality", value: starBar(draft.quality), inline: true },
      {
        name: "Recommend",
        value: draft.wouldRecommend ? "Yes" : "No",
        inline: true,
      },
      { name: "Photos", value: String(photos.length), inline: true },
    ],
    auditDetails: {
      orderId: order.id,
      publicId: order.publicId,
      reviewId: review?.id,
      speed: draft.speed,
      quality: draft.quality,
      wouldRecommend: draft.wouldRecommend,
    },
  });

  return { ok: true, review: review! };
}

export async function handleServiceOrderReviewButton(
  interaction: ButtonInteraction
): Promise<boolean> {
  if (!interaction.inCachedGuild() && !interaction.channel?.isDMBased()) {
    /* allow DM review buttons */
  }
  const { ns, action, arg } = parseId(interaction.customId);
  if (ns !== "svc" || !action.startsWith("review")) return false;

  const orderId = Number(String(arg ?? "").split("-")[0]);
  if (!orderId) {
    await interaction.reply({ content: "Invalid review reference.", flags: 64 });
    return true;
  }

  // Resolve guild from interaction or from order row.
  let guildId = interaction.guildId;
  if (!guildId) {
    const [row] = await db
      .select({ guildId: serviceOrdersTable.guildId })
      .from(serviceOrdersTable)
      .where(eq(serviceOrdersTable.id, orderId))
      .limit(1);
    guildId = row?.guildId ?? null;
  }
  if (!guildId) {
    await interaction.reply({ content: "Order not found.", flags: 64 });
    return true;
  }

  const { getClan } = await import("./config");
  const clan = await getClan(guildId);
  if (!clan) {
    await interaction.reply({ content: "Clan not configured.", flags: 64 });
    return true;
  }

  const [order] = await db
    .select()
    .from(serviceOrdersTable)
    .where(and(eq(serviceOrdersTable.id, orderId), eq(serviceOrdersTable.guildId, guildId)))
    .limit(1);
  if (!order) {
    await interaction.reply({ content: "Order not found.", flags: 64 });
    return true;
  }
  if (order.customerId !== interaction.user.id) {
    await interaction.reply({
      content: "Only the customer who placed this order can leave a review.",
      flags: 64,
    });
    return true;
  }
  if (order.reviewSubmittedAt) {
    await interaction.reply({ content: "You already submitted a review. Thank you!", flags: 64 });
    return true;
  }
  if (order.status !== "completed") {
    await interaction.reply({ content: "Reviews open after the order is completed.", flags: 64 });
    return true;
  }

  const draft = getDraft(guildId, orderId, interaction.user.id);

  if (action === "reviewStart") {
    await interaction.reply({
      content: "**How fast was the service?** (1 = slow, 5 = lightning)",
      components: [starRow(orderId, "speed", draft.speed)],
      flags: 64,
    });
    return true;
  }

  if (action === "reviewSpeed") {
    const stars = Number(String(arg).split("-")[1]);
    if (stars < 1 || stars > 5) {
      await interaction.reply({ content: "Pick 1–5 stars.", flags: 64 });
      return true;
    }
    draft.speed = stars;
    saveDraft(interaction.user.id, draft);
    await interaction.update({
      content: `Speed: ${starBar(stars)}\n\n**How good was the leveling quality?**`,
      components: [starRow(orderId, "quality", draft.quality)],
    });
    return true;
  }

  if (action === "reviewQuality") {
    const stars = Number(String(arg).split("-")[1]);
    if (stars < 1 || stars > 5) {
      await interaction.reply({ content: "Pick 1–5 stars.", flags: 64 });
      return true;
    }
    draft.quality = stars;
    saveDraft(interaction.user.id, draft);
    await interaction.update({
      content:
        `Speed: ${starBar(draft.speed!)}\nQuality: ${starBar(stars)}\n\n` +
        `**Would you use / recommend our leveling services again?**`,
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(svcReviewRecommend(orderId, 1))
            .setLabel("Yes — recommend")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(svcReviewRecommend(orderId, 0))
            .setLabel("No")
            .setEmoji("❌")
            .setStyle(ButtonStyle.Danger)
        ),
      ],
    });
    return true;
  }

  if (action === "reviewRecommend") {
    const yes = String(arg).split("-")[1] === "1";
    draft.wouldRecommend = yes;
    saveDraft(interaction.user.id, draft);
    await interaction.update({
      content:
        `Speed: ${starBar(draft.speed!)}\nQuality: ${starBar(draft.quality!)}\n` +
        `Recommend: ${yes ? "✅ Yes" : "❌ No"}\n\n` +
        `**Optional:** attach before/after photos in this channel, then press **Add photos & finish**, ` +
        `or skip to post the review card now.`,
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(svcReviewPhotos(orderId))
            .setLabel("Add photos & finish")
            .setEmoji("📷")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(svcReviewSkipPhotos(orderId))
            .setLabel("Skip photos & finish")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(svcReviewCommentModal(orderId))
            .setLabel("Add comment")
            .setEmoji("💬")
            .setStyle(ButtonStyle.Secondary)
        ),
      ],
    });
    return true;
  }

  if (action === "reviewComment") {
    const modal = new ModalBuilder()
      .setCustomId(svcReviewCommentModal(orderId))
      .setTitle("Review comment");
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("comment")
          .setLabel("Optional comment")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder("Anything else about the leveling experience…")
      )
    );
    await interaction.showModal(modal);
    return true;
  }

  if (action === "reviewPhotos" || action === "reviewSkipPhotos") {
    await interaction.deferUpdate();

    if (action === "reviewPhotos") {
      // Pull recent image uploads from the current channel by this user.
      const channel = interaction.channel;
      if (channel && channel.isTextBased() && "messages" in channel) {
        const messages = await channel.messages.fetch({ limit: 30 }).catch(() => null);
        if (messages) {
          const found: ServiceOrderAttachment[] = [];
          const seen = new Set<string>();
          for (const msg of messages.values()) {
            if (msg.author.id !== interaction.user.id) continue;
            for (const att of msg.attachments.values()) {
              if (!isImageAttachment({ contentType: att.contentType, name: att.name })) continue;
              if (seen.has(att.url)) continue;
              seen.add(att.url);
              found.push({
                url: att.url,
                name: att.name,
                contentType: att.contentType,
                size: att.size,
              });
              if (found.length >= SERVICE_ORDER_MAX_PHOTOS) break;
            }
            if (found.length >= SERVICE_ORDER_MAX_PHOTOS) break;
          }
          // Prefer order photos as fallback if user didn't upload new ones.
          if (!found.length) {
            found.push(
              ...parseAttachmentsJson(order.attachmentsJson)
                .filter((a) => isImageAttachment(a))
                .slice(0, SERVICE_ORDER_MAX_PHOTOS)
            );
          }
          draft.photos = found;
          saveDraft(interaction.user.id, draft);
        }
      } else {
        // DM: fall back to original order photos.
        draft.photos = parseAttachmentsJson(order.attachmentsJson)
          .filter((a) => isImageAttachment(a))
          .slice(0, SERVICE_ORDER_MAX_PHOTOS);
        saveDraft(interaction.user.id, draft);
      }
    }

    const published = await publishReview({
      client: interaction.client,
      clan,
      order,
      draft,
      actorId: interaction.user.id,
    });

    clearDraft(guildId, orderId, interaction.user.id);

    if (!published.ok) {
      await interaction.followUp({ content: `⚠️ ${published.error}`, flags: 64 });
      return true;
    }

    const where = clan.serviceOrderReviewChannelId
      ? ` Posted to <#${clan.serviceOrderReviewChannelId}>.`
      : " (Admin: set a **Reviews channel** in **/setup → Leveling Service** to show public cards.)";

    await interaction.followUp({
      content:
        `✅ Thanks for the review of **${order.publicId}**!` +
        `\nSpeed ${starBar(draft.speed!)} · Quality ${starBar(draft.quality!)} · ` +
        `Recommend: ${draft.wouldRecommend ? "Yes" : "No"}.` +
        where,
      flags: 64,
    });
    return true;
  }

  return false;
}

export async function handleServiceOrderReviewModal(
  interaction: ModalSubmitInteraction
): Promise<boolean> {
  const { ns, action, arg } = parseId(interaction.customId);
  if (ns !== "svc" || action !== "reviewComment") return false;

  const orderId = Number(arg);
  if (!orderId) {
    await interaction.reply({ content: "Invalid review reference.", flags: 64 });
    return true;
  }

  let guildId = interaction.guildId;
  if (!guildId) {
    const [row] = await db
      .select({ guildId: serviceOrdersTable.guildId })
      .from(serviceOrdersTable)
      .where(eq(serviceOrdersTable.id, orderId))
      .limit(1);
    guildId = row?.guildId ?? null;
  }
  if (!guildId) {
    await interaction.reply({ content: "Order not found.", flags: 64 });
    return true;
  }

  const draft = getDraft(guildId, orderId, interaction.user.id);
  draft.comment = interaction.fields.getTextInputValue("comment").trim() || null;
  saveDraft(interaction.user.id, draft);

  await interaction.reply({
    content: draft.comment
      ? "✅ Comment saved. Continue with **Add photos & finish** or **Skip photos & finish**."
      : "No comment added. Continue with the buttons above.",
    flags: 64,
  });
  return true;
}
