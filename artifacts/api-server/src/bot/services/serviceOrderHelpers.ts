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

export function serviceOrderChannelName(username: string, publicId: string): string {
  const stem = username
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `order-${stem || "member"}-${publicId.toLowerCase()}`.slice(0, 100);
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

/** Staff canned replies on order cards (value = key). */
export const STAFF_QUICK_REPLIES: ReadonlyArray<{ key: string; label: string; message: string }> = [
  {
    key: "qr0",
    label: "Almost ready — please be patient",
    message:
      "🛠️ Almost ready — please be patient a little longer! We're wrapping your order up now.",
  },
  {
    key: "qr1",
    label: "Working on it — hang tight",
    message: "🔧 We're working on it! Hang tight — no need to ping, we'll update you here.",
  },
  {
    key: "qr2",
    label: "Queue is moving — thanks",
    message: "📈 The queue is moving — thanks for your patience. You're still on our radar.",
  },
  {
    key: "qr3",
    label: "In good hands — sit tight",
    message: "🙌 Your order is in good hands. Sit tight and we'll ping you when there's news.",
  },
  {
    key: "qr4",
    label: "Nearly there",
    message: "🏁 Nearly there! Just finishing a few details — please be patient.",
  },
  {
    key: "qr5",
    label: "Staff on it — don't spam ping",
    message:
      "👀 Staff are on it — please don't ping repeatedly. We'll post here as soon as there's an update.",
  },
  {
    key: "qr6",
    label: "Progress happening — patience is XP",
    message: "✨ Progress is happening. Patience is XP — thanks for waiting with us.",
  },
  {
    key: "qr7",
    label: "Still cooking — wait for update",
    message: "🍳 Still cooking… please wait for the next update in this ticket.",
  },
  {
    key: "qr8",
    label: "We see you — stay patient",
    message:
      "🫡 We see you! Service is underway — please stay patient and keep an eye on this channel.",
  },
  {
    key: "qr9",
    label: "Almost at the finish line",
    message:
      "🚗 Almost parked at the finish line — please be patient just a bit longer. Appreciate you!",
  },
];

export function staffQuickReplyByKey(key: string): string | null {
  return STAFF_QUICK_REPLIES.find((r) => r.key === key)?.message ?? null;
}

/** Clear patient reminder for customers (panel + ticket). */
export const SERVICE_ORDER_PATIENCE_NOTICE =
  "**Please be patient.** Staff work the queue in order. Don't spam-ping — updates land in your ticket.";

