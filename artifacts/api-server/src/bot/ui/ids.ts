/**
 * Central registry of interaction custom IDs. Encoding is `ns:action:arg?`.
 * Keeping every ID in one place prevents the classic "magic string" drift
 * between the component that emits an interaction and the handler that routes it.
 */
export const NS = {
  review: "rev", // weekly review card actions
  dash: "dash", // warning dashboard
  setup: "setup", // configuration hub
  warn: "warn", // warnings management
  mgr: "mgr", // XP Manager hub (spreadsheet roster + member panel)
  hub: "hub", // Warnings & Enforcement hub
  note: "note", // member-facing note acknowledgement
  me: "me", // member self-view (/xp for non-officers)
  notif: "ntf", // staff notification queue (Read / Clear)
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

// Weekly review card
export const REVIEW_REMIND = id(NS.review, "remind");
export const REVIEW_WARN = id(NS.review, "warn");
export const REVIEW_WARN_CONFIRM = id(NS.review, "warnConfirm");
export const REVIEW_EXPORT = id(NS.review, "export");
export const REVIEW_REFRESH = id(NS.review, "refresh");
export const REVIEW_RESET_WEEK = id(NS.review, "resetWeek");
export const REVIEW_RESET_CONFIRM = id(NS.review, "resetConfirm");

// Warning dashboard
export const DASH_REFRESH = id(NS.dash, "refresh");
export const DASH_FILTER = id(NS.dash, "filter");
export const dashPage = (filter: string, page: number) => id(NS.dash, "page", `${filter}-${page}`);

// Configuration hub sections
export const SETUP_GOAL = id(NS.setup, "goal");
export const SETUP_GOAL_MODAL = id(NS.setup, "goalModal");
export const SETUP_MODE = id(NS.setup, "mode");
export const SETUP_SCHEDULE = id(NS.setup, "schedule");
export const SETUP_SCHEDULE_MODAL = id(NS.setup, "scheduleModal");
export const SETUP_CHANNELS = id(NS.setup, "channels");
export const SETUP_ROLES = id(NS.setup, "roles");
export const SETUP_NOTIFY = id(NS.setup, "notify");
export const SETUP_BACK = id(NS.setup, "back");
export const SETUP_FINISH = id(NS.setup, "finish");
// Channel selects
export const SETUP_REMINDER_CHANNEL = id(NS.setup, "reminderChannel");
export const SETUP_WARNING_CHANNEL = id(NS.setup, "warningChannel");
export const SETUP_LOG_CHANNEL = id(NS.setup, "logChannel");
// Role selects
export const SETUP_TRACKING_ROLE = id(NS.setup, "trackingRole");
export const SETUP_OFFICER_ROLES = id(NS.setup, "officerRoles");
export const SETUP_ADMIN_ROLES = id(NS.setup, "adminRoles");
export const SETUP_EXEMPT_ROLES = id(NS.setup, "exemptRoles");
export const SETUP_LEAVE_ROLES = id(NS.setup, "leaveRoles");
export const SETUP_WARN_ROLES = id(NS.setup, "warnRoles");
// Notification toggles (arg = key)
export const setupToggle = (key: string) => id(NS.setup, "toggle", key);

// Warnings management. Arg carries the target user id.
export const warnRemoveSelect = (userId: string) => id(NS.warn, "remove", userId);

/* ------------------------------------------------------------ XP Manager hub */
// Category tabs / roster. Arg encodes "<filter>" or "<filter>-<page>".
export const mgrCat = (filter: string) => id(NS.mgr, "cat", filter);
export const mgrPage = (filter: string, page: number) => id(NS.mgr, "page", `${filter}-${page}`);
export const mgrPick = (filter: string, page: number) => id(NS.mgr, "pick", `${filter}-${page}`);
export const MGR_REFRESH = id(NS.mgr, "refresh");
export const MGR_ENTER = id(NS.mgr, "enter");
// Member panel. Arg carries the target user id; a trailing "|<filter>-<page>"
// lets Back return to the exact roster tab/page the officer came from.
export const mgrMember = (action: string, userId: string) => id(NS.mgr, action, userId);
// Modals opened from the member panel.
export const mgrAddXpModal = (userId: string) => id(NS.mgr, "addxpModal", userId);
export const mgrRemXpModal = (userId: string) => id(NS.mgr, "remxpModal", userId);
export const mgrBackXpModal = (userId: string) => id(NS.mgr, "backxpModal", userId);
export const mgrNoteModal = (userId: string) => id(NS.mgr, "noteModal", userId);
export const mgrWarnModal = (userId: string) => id(NS.mgr, "warnModal", userId);
export const mgrRemoveWarnSelect = (userId: string) => id(NS.mgr, "removeWarn", userId);

/* ----------------------------------------------- Warnings & Enforcement hub */
export const hubTab = (tab: string) => id(NS.hub, "tab", tab);
export const HUB_REFRESH = id(NS.hub, "refresh");
export const HUB_DPICK = id(NS.hub, "dpick");
export const hubDispute = (action: string, disputeId: number) => id(NS.hub, action, disputeId);
export const hubDisputeNoteModal = (disputeId: number) => id(NS.hub, "dnote", disputeId);

/* ---------------------------------------------------------- Member self view */
export const ME_CALENDAR = id(NS.me, "calendar");
export const ME_WARNINGS = id(NS.me, "warnings");
export const ME_HISTORY = id(NS.me, "history");
export const ME_DISPUTE = id(NS.me, "dispute");
export const meDisputeModal = (warningId: string) => id(NS.me, "disputeModal", warningId);
// Member note acknowledgement — clears the note once the member has read it.
export const noteAck = (userId: string) => id(NS.note, "ack", userId);

/* -------------------------------------------------- Staff notification queue */
export const NOTIF_REFRESH = id(NS.notif, "refresh");
export const NOTIF_CLEAR_ALL = id(NS.notif, "clearAll");
export const NOTIF_PICK = id(NS.notif, "pick");
export const notifAction = (action: string, notifId: number) => id(NS.notif, action, notifId);
