import type { ServiceKey, ServiceOrderStatus } from "@workspace/db/schema";
import {
  SERVICE_ORDER_QUEUE_STATUSES,
  type ServiceOrder,
  type ServiceOrderAttachment,
} from "@workspace/db/schema";

export const SERVICE_CATALOG: Record<
  ServiceKey,
  { label: string; emoji: string; blurb: string }
> = {
  vehicle_leveling: {
    label: "Vehicle Leveling",
    emoji: "🛠️",
    blurb: "Military Tycoon vehicle leveling",
  },
  vehicle_trading: {
    label: "Vehicle Trading",
    emoji: "🚗",
    blurb: "Military Tycoon vehicle trading help",
  },
  other: {
    label: "Other Service",
    emoji: "📋",
    blurb: "Another Military Tycoon service",
  },
};

export const STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  received: "Received",
  queued: "In Queue",
  claimed: "Staff Assigned",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const STATUS_EMOJI: Record<ServiceOrderStatus, string> = {
  received: "🟡",
  queued: "🔵",
  claimed: "🟣",
  in_progress: "🟠",
  on_hold: "⏸️",
  completed: "🟢",
  rejected: "❌",
  cancelled: "🚫",
};

export const STATUS_COLOR: Record<ServiceOrderStatus, number> = {
  received: 0xf1c40f,
  queued: 0x3498db,
  claimed: 0x9b59b6,
  in_progress: 0xe67e22,
  on_hold: 0x95a5a6,
  completed: 0x2ecc71,
  rejected: 0xe74c3c,
  cancelled: 0x7f8c8d,
};

export function isQueueStatus(status: string): boolean {
  return (SERVICE_ORDER_QUEUE_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "rejected" || status === "cancelled";
}

export function formatPublicId(n: number): string {
  return `LV-${String(Math.max(1, n)).padStart(4, "0")}`;
}

/** Discord channel name: lvl-up-{name}-{n} (no LV-#### — that looked like a level). */
export function serviceOrderChannelName(opts: {
  username: string;
  displayName?: string | null;
  sequence: number;
}): string {
  const raw = (opts.displayName?.trim() || opts.username).trim();
  const stem = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const n = Math.max(1, Math.floor(opts.sequence));
  return `lvl-up-${stem || "member"}-${n}`.slice(0, 100);
}

/** Pretty topic / display label: LVL-Up Name-#1 */
export function serviceOrderChannelTopic(opts: {
  username: string;
  displayName?: string | null;
  sequence: number;
}): string {
  const name = (opts.displayName?.trim() || opts.username).trim() || "member";
  const n = Math.max(1, Math.floor(opts.sequence));
  return `LVL-Up ${name}-#${n}`;
}

export function parseAttachmentsJson(raw: string | null | undefined): ServiceOrderAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (a): a is ServiceOrderAttachment =>
          !!a && typeof a === "object" && typeof (a as ServiceOrderAttachment).url === "string"
      )
      .map((a) => ({
        url: a.url,
        name: typeof a.name === "string" ? a.name : "file",
        contentType: typeof a.contentType === "string" ? a.contentType : null,
        size: typeof a.size === "number" ? a.size : 0,
      }));
  } catch {
    return [];
  }
}

export function serializeAttachments(items: ServiceOrderAttachment[]): string | null {
  return items.length ? JSON.stringify(items) : null;
}

export function denseQueuePositions(orders: { id: number }[]): Map<number, number> {
  const map = new Map<number, number>();
  orders.forEach((o, i) => map.set(o.id, i + 1));
  return map;
}

export function ordersAhead(position: number | null | undefined): number {
  if (position == null || position <= 1) return 0;
  return position - 1;
}

export function queueHeadline(
  order: Pick<ServiceOrder, "queuePosition" | "status" | "publicId">
): string {
  const status = order.status as ServiceOrderStatus;
  if (isTerminalStatus(status)) {
    return `${STATUS_EMOJI[status] ?? ""} ${STATUS_LABEL[status] ?? order.status}`;
  }
  const pos = order.queuePosition ?? 1;
  const ahead = ordersAhead(pos);
  return [
    `${STATUS_EMOJI[status] ?? "🔵"} ${STATUS_LABEL[status] ?? order.status}`,
    `Position #${pos}`,
    ahead === 0 ? "You're next" : `${ahead} order${ahead === 1 ? "" : "s"} ahead`,
  ].join(" · ");
}

export function statusTone(
  status: ServiceOrderStatus
): "queue" | "active" | "hold" | "done" | "bad" {
  if (status === "completed") return "done";
  if (status === "rejected" || status === "cancelled") return "bad";
  if (status === "on_hold") return "hold";
  if (status === "claimed" || status === "in_progress") return "active";
  return "queue";
}

export function resolveServiceKey(raw: string): ServiceKey {
  const n = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (n === "vehicle_trading" || n.includes("trad")) return "vehicle_trading";
  if (n === "vehicle_leveling" || n.includes("level") || n.includes("vehicle")) {
    return "vehicle_leveling";
  }
  if (n === "other") return "other";
  return "other";
}

/** Exact ephemeral deny copy when Place Service Order is blocked by ACL. */
export const SERVICE_ORDER_ACCESS_DENIED =
  "🚫 Whoa there!\n" +
  "This service counter isn't open for you just yet. You don't have permission to place a service order here. " +
  "If you think this is a mistake, contact the staff team.";

/**
 * Blacklist always overrides whitelist.
 * Empty whitelist → everyone except blacklisted.
 * Non-empty whitelist → only listed users/roles (unless blacklisted).
 */
export function canPlaceServiceOrderAccess(opts: {
  userId: string;
  memberRoleIds: readonly string[];
  whitelistUserIds: readonly string[];
  whitelistRoleIds: readonly string[];
  blacklistUserIds: readonly string[];
  blacklistRoleIds: readonly string[];
}): boolean {
  const {
    userId,
    memberRoleIds,
    whitelistUserIds,
    whitelistRoleIds,
    blacklistUserIds,
    blacklistRoleIds,
  } = opts;

  if (blacklistUserIds.includes(userId)) return false;
  if (blacklistRoleIds.some((id) => memberRoleIds.includes(id))) return false;

  const hasWhitelist = whitelistUserIds.length > 0 || whitelistRoleIds.length > 0;
  if (!hasWhitelist) return true;

  if (whitelistUserIds.includes(userId)) return true;
  if (whitelistRoleIds.some((id) => memberRoleIds.includes(id))) return true;
  return false;
}

/**
 * Staff canned replies on the **orders board** only.
 * Labels are explicit so staff can tap without typing during first contact.
 */
export const STAFF_QUICK_REPLIES: ReadonlyArray<{ key: string; label: string; message: string }> = [
  {
    key: "greet",
    label: "Greeting: Thanks for requesting",
    message:
      "👋 Thanks for requesting a ticket — we've got your order. A staff member will claim it shortly. Please stay patient in queue.",
  },
  {
    key: "brb",
    label: "Greeting: Be right with you",
    message: "⏱️ Be right with you — reviewing your order details now.",
  },
  {
    key: "claimed",
    label: "Greeting: Claimed & starting",
    message:
      "🛠️ Your order has been claimed. We're starting work — hang tight and we'll update you here.",
  },
  {
    key: "needinfo",
    label: "Ask: Need more info",
    message:
      "📝 We need a bit more info to continue — please reply with vehicle name(s), current level, and target level if anything is missing.",
  },
  {
    key: "queue",
    label: "Update: Still in queue",
    message:
      "📋 You're still in queue. We'll ping you as soon as a staff member is free. Thanks for your patience!",
  },
  {
    key: "almost",
    label: "Update: Almost done",
    message: "✨ Almost done — wrapping up your order now. Thanks for waiting!",
  },
  {
    key: "working",
    label: "Update: Working on it",
    message: "🔧 We're working on it! Hang tight — no need to ping, we'll update you here.",
  },
  {
    key: "patience",
    label: "Update: Please be patient",
    message:
      "👀 Staff are on it — please don't ping repeatedly. We'll post here as soon as there's an update.",
  },
];

/** Customer quick messages on the ticket canvas (cooldown enforced in feature handler). */
export const CUSTOMER_QUICK_REPLIES: ReadonlyArray<{ key: string; label: string; message: string }> = [
  {
    key: "cq0",
    label: "Has my order started?",
    message: "👋 Checking in — has my order started yet?",
  },
  {
    key: "cq1",
    label: "Is my order done?",
    message: "🏁 Checking in — is my order finished / ready?",
  },
  {
    key: "cq2",
    label: "Any queue update?",
    message: "📍 Any update on my queue position? Still waiting patiently.",
  },
  {
    key: "cq3",
    label: "Need a quick status",
    message: "🔔 Quick status check when you have a moment — thanks!",
  },
];

/** Example tag words for placeholders only — customers type their own tags. */
export const SERVICE_ORDER_TAG_EXAMPLES = ["Vehicle", "XP", "Urgent", "Grinding", "Other"] as const;

/** Split free-text tags (comma / pipe / slash separated). */
export function parseTagsField(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[,|/]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** @deprecated Use free-text tags via parseTagsField — kept for older panels. */
export const SERVICE_ORDER_TAGS: ReadonlyArray<{ value: string; label: string; emoji: string }> = [
  { value: "Vehicle", label: "Vehicle", emoji: "🚗" },
  { value: "XP", label: "XP", emoji: "📊" },
  { value: "Urgent", label: "Urgent", emoji: "❗" },
  { value: "Grinding", label: "Grinding", emoji: "⛏️" },
  { value: "Other", label: "Other", emoji: "⋯" },
];

export function customerQuickReplyByKey(key: string): string | null {
  return CUSTOMER_QUICK_REPLIES.find((r) => r.key === key)?.message ?? null;
}

/** Cooldown between customer quick replies (ms). */
export const CUSTOMER_QUICK_REPLY_COOLDOWN_MS = 3 * 60 * 1000;

export function staffQuickReplyByKey(key: string): string | null {
  return STAFF_QUICK_REPLIES.find((r) => r.key === key)?.message ?? null;
}

export type ParsedServiceOrderDetails = {
  serviceLabel: string;
  vehicleText: string;
  vehicleCount: number;
  currentLevel: number | null;
  targetLevel: number | null;
  tags: string[];
  notes: string;
  raw: string;
};

const DETAIL_SERVICE = /^Service:\s*(.+)$/im;
const DETAIL_VEHICLE = /^Vehicle(?:\(s\)|s)?:\s*(.+)$/im;
const DETAIL_LEVELS = /^Levels?:\s*(\d+)\s*(?:→|->|to)\s*(\d+)/im;
const DETAIL_TAGS = /^Tags?:\s*(.+)$/im;

export function parseServiceOrderDetails(details: string | null | undefined): ParsedServiceOrderDetails {
  const raw = String(details ?? "").trim();
  const serviceMatch = raw.match(DETAIL_SERVICE);
  const vehicleMatch = raw.match(DETAIL_VEHICLE);
  const levelsMatch = raw.match(DETAIL_LEVELS);
  const tagsMatch = raw.match(DETAIL_TAGS);

  const vehicleText = (vehicleMatch?.[1] ?? "").trim();
  const vehicleParts = vehicleText
    ? vehicleText.split(/[,|/]+/).map((p) => p.trim()).filter(Boolean)
    : [];
  const vehicleCount = vehicleParts.length > 0 ? vehicleParts.length : vehicleText ? 1 : 0;

  const tags = tagsMatch?.[1]
    ? tagsMatch[1]
        .split(/[,|]+/)
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const notes = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !DETAIL_SERVICE.test(line) &&
        !DETAIL_VEHICLE.test(line) &&
        !DETAIL_LEVELS.test(line) &&
        !DETAIL_TAGS.test(line)
    )
    .join("\n");

  return {
    serviceLabel: (serviceMatch?.[1] ?? "").trim() || "Service order",
    vehicleText,
    vehicleCount,
    currentLevel: levelsMatch ? Number(levelsMatch[1]) : null,
    targetLevel: levelsMatch ? Number(levelsMatch[2]) : null,
    tags,
    notes,
    raw,
  };
}

export function formatServiceOrderDetails(input: {
  serviceLabel: string;
  vehicleText: string;
  currentLevel: number;
  targetLevel: number;
  tags: string[];
  notes?: string;
}): string {
  const lines = [
    `Service: ${input.serviceLabel}`,
    `Vehicle(s): ${input.vehicleText}`,
    `Levels: ${input.currentLevel} → ${input.targetLevel}`,
  ];
  if (input.tags.length > 0) {
    lines.push(`Tags: ${input.tags.join(", ")}`);
  }
  if (input.notes?.trim()) {
    lines.push("", input.notes.trim());
  }
  return lines.join("\n");
}

/** Friendly queue/place line for the customer ticket canvas. */
export function queuePlaceMessage(position: number | null | undefined, vehicleCount: number): string {
  const pos = typeof position === "number" && position > 0 ? position : null;
  const vehicles =
    vehicleCount <= 0
      ? "No vehicles listed yet"
      : vehicleCount === 1
        ? "1 vehicle"
        : `${vehicleCount} vehicles`;
  if (!pos) {
    return `Your order is on file · ${vehicles}`;
  }
  if (pos === 1) {
    return `You're #1 in queue — next up · ${vehicles}`;
  }
  return `You're #${pos} in queue · ${vehicles}`;
}

/** Clear patient reminder for customers (panel + ticket). */
export const SERVICE_ORDER_PATIENCE_NOTICE =
  "**Please be patient.** Staff work the queue in order. Don't spam-ping — updates land in your ticket.";

