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

// Warnings management. Arg carries the target user id.
export const warnRemoveSelect = (userId: string) => id(NS.warn, "remove", userId);

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
// Jump straight into a filtered dashboard category (arg = dash filter).
export const ccCategory = (filter: string) => id(NS.cc, "cat", filter);
