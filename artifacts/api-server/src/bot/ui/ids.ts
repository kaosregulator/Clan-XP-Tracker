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
  cc: "cc", // persistent live command center
  notif: "ntf", // notification center
  disp: "dsp", // disputes
  tkt: "tkt", // tickets
  mp: "mp", // member panel actions
  aud: "aud", // xp history / audit viewer
  hub: "hub", // member self-service hub (/warnings for members)
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
export const SETUP_OFFICER_ROLES = id(NS.setup, "officerRoles");
export const SETUP_ADMIN_ROLES = id(NS.setup, "adminRoles");
export const SETUP_EXEMPT_ROLES = id(NS.setup, "exemptRoles");
export const SETUP_LEAVE_ROLES = id(NS.setup, "leaveRoles");
export const SETUP_WARN_ROLES = id(NS.setup, "warnRoles");
// Notification toggles (arg = key)
export const setupToggle = (key: string) => id(NS.setup, "toggle", key);

/* Guided setup wizard. All actions are prefixed "wiz" so they never collide
 * with the configuration hub's actions (goal, channels, warnRoles, …). Compound
 * args use "-" the way dashPage does. */
export const wizGo = (step: number) => id(NS.setup, "wizGo", step); // render step N
export const wizEdit = (step: number) => id(NS.setup, "wizEdit", step); // open step N's modal
export const wizModal = (step: number) => id(NS.setup, "wizModal", step); // modal submit for step N
export const wizToggle = (key: string, step: number) => id(NS.setup, "wizToggle", `${key}-${step}`);
export const wizSel = (field: string, step: number) => id(NS.setup, "wizSel", `${field}-${step}`);
export const WIZ_FINISH = id(NS.setup, "wizFinish");
export const WIZ_CANCEL = id(NS.setup, "wizCancel");
export const WIZ_HUB = id(NS.setup, "wizHub"); // jump to the advanced edit hub

// Notification center.
export const NOTIF_REFRESH = id(NS.notif, "refresh");
export const NOTIF_READ_ALL = id(NS.notif, "readAll");
export const NOTIF_CLEAR_READ = id(NS.notif, "clearRead");
export const NOTIF_PICK = id(NS.notif, "pick"); // string-select of notifications
export const notifRead = (nid: number) => id(NS.notif, "read", nid);
export const notifClear = (nid: number) => id(NS.notif, "clear", nid);
export const notifResolve = (nid: number) => id(NS.notif, "resolve", nid);
export const notifMember = (userId: string) => id(NS.notif, "member", userId);

// Disputes. Member picks a warning to dispute; staff act on a dispute id.
export const DISPUTE_PICK = id(NS.disp, "pick"); // member: select a warning
export const disputeReasonModal = (warningId: number) => id(NS.disp, "reason", warningId);
export const DISPUTE_REVIEW_PICK = id(NS.disp, "review"); // staff: select a dispute
export const disputeAccept = (did: number) => id(NS.disp, "accept", did);
export const disputeDeny = (did: number) => id(NS.disp, "deny", did);
export const disputeInfo = (did: number) => id(NS.disp, "info", did);
export const disputeTicket = (did: number) => id(NS.disp, "ticket", did);
export const disputeRemoveWarning = (did: number) => id(NS.disp, "remwarn", did);
export const disputeMember = (userId: string) => id(NS.disp, "member", userId);

// Tickets.
export const TICKET_PICK = id(NS.tkt, "pick");
export const ticketProgress = (tid: number) => id(NS.tkt, "progress", tid);
export const ticketResolve = (tid: number) => id(NS.tkt, "resolve", tid);
export const ticketClose = (tid: number) => id(NS.tkt, "close", tid);
export const ticketAssign = (tid: number) => id(NS.tkt, "assign", tid);

// Member panel actions (arg = target user id).
export const mpAddXp = (userId: string) => id(NS.mp, "addxp", userId);
export const mpRemoveXp = (userId: string) => id(NS.mp, "remxp", userId);
export const mpComplete = (userId: string) => id(NS.mp, "complete", userId);
export const mpRemind = (userId: string) => id(NS.mp, "remind", userId);
export const mpWarn = (userId: string) => id(NS.mp, "warn", userId);
export const mpXpModal = (kind: string, userId: string) => id(NS.mp, "xpModal", `${kind}-${userId}`);

// XP history / audit viewer (arg = "<userId>-<page>").
export const audPage = (userId: string, page: number) => id(NS.aud, "page", `${userId}-${page}`);

// Warnings management. Arg carries the target user id.
export const warnRemoveSelect = (userId: string) => id(NS.warn, "remove", userId);

// Member self-service hub (/warnings). Every action carries the target user id
// so the handler can re-check ownership before doing anything (buttons are
// safeguarded: only the member themselves — or an officer — may use them).
export const hubDispute = (userId: string) => id(NS.hub, "dispute", userId);
export const hubCalendar = (userId: string) => id(NS.hub, "calendar", userId);
export const hubHistory = (userId: string) => id(NS.hub, "history", userId);
export const hubRefresh = (userId: string) => id(NS.hub, "refresh", userId);

// Persistent live command center. Buttons route staff into existing hubs; the
// category shortcuts open the warning dashboard already filtered.
export const CC_REFRESH = id(NS.cc, "refresh");
export const CC_MANAGE = id(NS.cc, "manage"); // → dashboard (all)
export const CC_WARNINGS = id(NS.cc, "warnings"); // → dashboard (warned)
export const CC_NOTIFS = id(NS.cc, "notifs"); // → live attention feed
export const CC_REPORTS = id(NS.cc, "reports"); // → weekly review card
export const CC_CALENDAR = id(NS.cc, "calendar"); // → calendar helper
export const CC_SEARCH = id(NS.cc, "search"); // → member lookup (user select)
export const CC_SEARCH_SELECT = id(NS.cc, "searchSelect");
export const CC_DISPUTES = id(NS.cc, "disputes"); // → dispute review hub
export const CC_TICKETS = id(NS.cc, "tickets"); // → ticket list
// Jump straight into a filtered dashboard category (arg = dash filter).
export const ccCategory = (filter: string) => id(NS.cc, "cat", filter);
