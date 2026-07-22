/**
 * Central registry of interaction custom IDs. Encoding is `ns:action:arg?`.
 * Keeping every ID in one place prevents the classic "magic string" drift
 * between the component that emits an interaction and the handler that routes it.
 */
export const NS = {
  xp: "xp", // member hub
  admin: "adm", // staff hub
  review: "rev", // review queue card
  setup: "setup", // setup wizard
  warn: "warn", // warnings management
  tracker: "trk", // admin progress tracker embed
} as const;

export function id(ns: string, action: string, arg?: string | number): string {
  return arg === undefined ? `${ns}:${action}` : `${ns}:${action}:${arg}`;
}

export interface ParsedId {
  ns: string;
  action: string;
  arg?: string;
}

export function parseId(customId: string): ParsedId {
  const [ns = "", action = "", arg] = customId.split(":");
  return { ns, action, arg };
}

// Member hub
export const XP_SUBMIT = id(NS.xp, "submit");
export const XP_PROGRESS = id(NS.xp, "progress");
export const XP_HISTORY = id(NS.xp, "history");
export const XP_REFRESH = id(NS.xp, "refresh");
export const XP_SUBMIT_MODAL = id(NS.xp, "submitModal");
export const XP_VACATION = id(NS.xp, "vacation");
export const XP_ACCOUNTS = id(NS.xp, "accounts");
export const XP_ADD_ACCOUNT = id(NS.xp, "addAccount");
export const XP_ADD_ACCOUNT_MODAL = id(NS.xp, "addAccountModal");
export const XP_REMOVE_ACCOUNT = id(NS.xp, "removeAccount");
export const XP_SUBMIT_ACCOUNT = id(NS.xp, "submitAccount");

// Submission modal
export const MODAL_SUBMIT = id(NS.xp, "submitModal");

// Admin hub
export const ADMIN_QUEUE = id(NS.admin, "queue");
export const ADMIN_MISSING = id(NS.admin, "missing");
export const ADMIN_LEADERBOARD = id(NS.admin, "leaderboard");
export const ADMIN_REFRESH = id(NS.admin, "refresh");

// Review card actions take the submission id as arg
export const reviewApprove = (subId: number) => id(NS.review, "approve", subId);
export const reviewReject = (subId: number) => id(NS.review, "reject", subId);
export const reviewRemind = (subId: number) => id(NS.review, "remind", subId);
export const reviewWarn = (subId: number) => id(NS.review, "warn", subId);
export const reviewHistory = (subId: number) => id(NS.review, "history", subId);
export const reviewRejectModal = (subId: number) => id(NS.review, "rejectModal", subId);
export const reviewWarnModal = (subId: number) => id(NS.review, "warnModal", subId);

// Setup wizard sections
export const SETUP_IDENTITY = id(NS.setup, "identity");
export const SETUP_GAME = id(NS.setup, "game");
export const SETUP_SCHEDULE = id(NS.setup, "schedule");
export const SETUP_CAPACITY = id(NS.setup, "capacity");
export const SETUP_CAPACITY_MODAL = id(NS.setup, "capacityModal");
export const SETUP_CHANNELS = id(NS.setup, "channels");
export const SETUP_ROLES = id(NS.setup, "roles");
export const SETUP_CREATE_CHANNELS = id(NS.setup, "createChannels");
export const SETUP_FINISH = id(NS.setup, "finish");
export const SETUP_IDENTITY_MODAL = id(NS.setup, "identityModal");
export const SETUP_GAME_MODAL = id(NS.setup, "gameModal");
export const SETUP_SCHEDULE_MODAL = id(NS.setup, "scheduleModal");
export const SETUP_SUB_CHANNEL = id(NS.setup, "subChannel");
export const SETUP_REVIEW_CHANNEL = id(NS.setup, "reviewChannel");
export const SETUP_LOG_CHANNEL = id(NS.setup, "logChannel");
export const SETUP_STAFF_ROLES = id(NS.setup, "staffRoles");
export const SETUP_WARN_ROLES = id(NS.setup, "warnRoles");
export const SETUP_BACK = id(NS.setup, "back");
export const SETUP_DASHBOARDS = id(NS.setup, "dashboards");
export const SETUP_STAFF_DASH = id(NS.setup, "staffDash");
export const SETUP_CLAN_DASH = id(NS.setup, "clanDash");
export const SETUP_PATRIOT_DASH = id(NS.setup, "patriotDash");
export const SETUP_TRACKER_CHANNEL = id(NS.setup, "trackerChannel");
export const SETUP_REQUIRED_ROLE = id(NS.setup, "requiredRole");

// Admin tracker embed actions
export const TRACKER_REMIND = id(NS.tracker, "remind");
export const TRACKER_REFRESH = id(NS.tracker, "refresh");

// Warnings management. Arg carries the target user id.
export const warnRemoveSelect = (userId: string) => id(NS.warn, "remove", userId);
