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
