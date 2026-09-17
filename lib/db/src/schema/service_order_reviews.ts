import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Customer reviews left after a leveling / service order is completed.
 * Photos are before/after proof the customer attaches during the review flow.
 */

export const serviceOrderReviewsTable = pgTable(
  "service_order_reviews",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    orderId: integer("order_id").notNull(),
    publicId: text("public_id").notNull(),

    customerId: text("customer_id").notNull(),
    customerUsername: text("customer_username").notNull(),
    customerDisplayName: text("customer_display_name").notNull(),

    staffId: text("staff_id"),
    staffUsername: text("staff_username"),

    serviceKey: text("service_key").notNull(),
    serviceLabel: text("service_label").notNull(),

    /** 1–5 stars for how fast the service was. */
    speedRating: integer("speed_rating").notNull(),
    /** 1–5 stars for leveling quality. */
    qualityRating: integer("quality_rating").notNull(),
    /** Would they use / recommend the service again. */
    wouldRecommend: boolean("would_recommend").notNull(),

    comment: text("comment"),

    /** Before/after photos as JSON ServiceOrderAttachment[]. */
    photosJson: text("photos_json"),
    photoCount: integer("photo_count").notNull().default(0),

    /** Public review-card message in the configured reviews channel. */
    reviewChannelId: text("review_channel_id"),
    reviewMessageId: text("review_message_id"),

    orderCreatedAt: timestamp("order_created_at", { withTimezone: true }),
    orderCompletedAt: timestamp("order_completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("service_order_reviews_order_uidx").on(t.orderId)]
);

export const insertServiceOrderReviewSchema = createInsertSchema(
  serviceOrderReviewsTable
).omit({
  id: true,
  createdAt: true,
});
export type InsertServiceOrderReview = z.infer<typeof insertServiceOrderReviewSchema>;
export type ServiceOrderReview = typeof serviceOrderReviewsTable.$inferSelect;
