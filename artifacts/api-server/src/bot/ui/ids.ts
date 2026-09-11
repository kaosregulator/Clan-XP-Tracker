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
  enf: "enf", // unified enforcement picker (/xpreminder: reminder | warning)
  act: "act", // staff activity log picker (/activity)
  rbx: "rbx", // Roblox Hub (/roblox, /military)
  scout: "sct", // Game Intelligence Hub (/scout) — Bloxscout
  mkt: "mkt", // Marketplace Hub (/market) — avatar items
  link: "lnk", // Avatar link hub (/link) — Discord ↔ Roblox face
  svc: "svc", // Leveling / service-order queue
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
export const DASH_HOME = id(NS.dash, "home");
/** Open member browser at queue index (arg = `${filter}-${index}`). */
export const dashBrowse = (filter: string, index: number) =>
  id(NS.dash, "browse", `${filter}-${index}`);
export const dashPrev = (filter: string, index: number) =>
  id(NS.dash, "prev", `${filter}-${index}`);
export const dashNext = (filter: string, index: number) =>
  id(NS.dash, "next", `${filter}-${index}`);
/** Switch browse card mode: player (default) | editor. arg = `${filter}-${index}-player|editor`. */
export const dashView = (filter: string, index: number, view: "player" | "editor") =>
  id(NS.dash, "view", `${filter}-${index}-${view}`);
/** Legacy page pager — kept so old messages still route. */
export const dashPage = (filter: string, page: number) => id(NS.dash, "page", `${filter}-${page}`);

// Configuration hub sections
export const SETUP_GOAL = id(NS.setup, "goal");
export const SETUP_GOAL_MODAL = id(NS.setup, "goalModal");
export const SETUP_MODE = id(NS.setup, "mode");
export const SETUP_PERIOD = id(NS.setup, "period");
export const SETUP_SCHEDULE = id(NS.setup, "schedule");
export const SETUP_SCHEDULE_MODAL = id(NS.setup, "scheduleModal");
export const SETUP_CHANNELS = id(NS.setup, "channels");
export const SETUP_ROLES = id(NS.setup, "roles");
export const SETUP_NOTIFY = id(NS.setup, "notify");
export const SETUP_WHITELIST = id(NS.setup, "whitelist");
export const SETUP_CARDS = id(NS.setup, "cards");
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
/** Role whose members are tracked for clan activity (leaderboard / requirements). */
export const SETUP_REQUIRED_ROLE = id(NS.setup, "requiredRole");
/** Wizard / hub: create a default "Clan Activity" Discord role and select it. */
export const SETUP_CREATE_TRACK_ROLE = id(NS.setup, "createTrackRole");
export const wizCreateTrackRole = (step: number) => id(NS.setup, "wizCreateTrack", step);
// Whitelist: individual users granted admin/staff command access.
export const SETUP_WHITELIST_USERS = id(NS.setup, "whitelistUsers");
// Enforcement cards & warning-role auto-removal.
export const SETUP_CARD_STYLE = id(NS.setup, "cardStyle");
export const SETUP_WARN_REMOVAL = id(NS.setup, "warnRemoval");
export const SETUP_WARN_REMOVAL_CUSTOM = id(NS.setup, "warnRemovalCustom");
export const SETUP_WARN_REMOVAL_MODAL = id(NS.setup, "warnRemovalModal");
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

// Disputes — private ticket channels. Staff act on a dispute id inside the channel.
export const DISPUTE_PICK = id(NS.disp, "pick"); // legacy: select a warning (hub redirect)
export const disputeReasonModal = (warningId: number) => id(NS.disp, "reason", warningId);
export const DISPUTE_REVIEW_PICK = id(NS.disp, "review"); // staff: select a dispute
export const disputeResolve = (did: number) => id(NS.disp, "resolve", did);
export const disputeReject = (did: number) => id(NS.disp, "reject", did);
export const disputeClose = (did: number) => id(NS.disp, "close", did);
export const disputeTranscript = (did: number) => id(NS.disp, "transcript", did);
export const disputeDelete = (did: number) => id(NS.disp, "delete", did);
// Legacy aliases kept so old messages still route somewhere sensible.
export const disputeAccept = (did: number) => id(NS.disp, "resolve", did);
export const disputeDeny = (did: number) => id(NS.disp, "reject", did);
export const disputeInfo = (did: number) => id(NS.disp, "info", did);
export const disputeTicket = (did: number) => id(NS.disp, "ticket", did);
export const disputeRemoveWarning = (did: number) => id(NS.disp, "remwarn", did);
export const disputeMember = (userId: string) => id(NS.disp, "member", userId);

// Setup — dispute ticket category / staff role.
export const SETUP_DISPUTES = id(NS.setup, "disputes");
export const SETUP_DISPUTE_CATEGORY = id(NS.setup, "disputeCategory");
export const SETUP_DISPUTE_STAFF_ROLE = id(NS.setup, "disputeStaffRole");
export const SETUP_DISPUTE_CREATE_CATEGORY = id(NS.setup, "disputeCreateCategory");

// Setup — leveling / service-order queue
export const SETUP_LEVELING = id(NS.setup, "leveling");
export const SETUP_LEVELING_CHANNEL = id(NS.setup, "levelingChannel");
export const SETUP_LEVELING_CATEGORY = id(NS.setup, "levelingCategory");
export const SETUP_LEVELING_TEAM_ROLE = id(NS.setup, "levelingTeamRole");
export const SETUP_LEVELING_CREATE_CATEGORY = id(NS.setup, "levelingCreateCategory");
export const SETUP_LEVELING_TOGGLE = id(NS.setup, "levelingToggle");
export const SETUP_LEVELING_POST_PANEL = id(NS.setup, "levelingPostPanel");
export const SETUP_LEVELING_ACCESS = id(NS.setup, "levelingAccess");
export const SETUP_LEVELING_WL_USERS = id(NS.setup, "levelingWlUsers");
export const SETUP_LEVELING_WL_ROLES = id(NS.setup, "levelingWlRoles");
export const SETUP_LEVELING_BL_USERS = id(NS.setup, "levelingBlUsers");
export const SETUP_LEVELING_BL_ROLES = id(NS.setup, "levelingBlRoles");
export const SETUP_LEVELING_CLEAR_WL = id(NS.setup, "levelingClearWl");
export const SETUP_LEVELING_CLEAR_BL = id(NS.setup, "levelingClearBl");


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
export const hubDisputeModal = (userId: string) => id(NS.hub, "disputeModal", userId);
export const hubCalendar = (userId: string) => id(NS.hub, "calendar", userId);
export const hubHistory = (userId: string) => id(NS.hub, "history", userId);
export const hubRefresh = (userId: string) => id(NS.hub, "refresh", userId);

// Unified enforcement picker (/xpreminder). One panel, two modes, native
// multi-user selection + a live canvas preview. State is keyed by the panel's
// (ephemeral) message id, so the ids themselves carry no per-panel payload.
export const ENF_MODE = id(NS.enf, "mode"); // toggle Reminder ⇄ Warning
export const ENF_SELECT = id(NS.enf, "select"); // native user multi-select
export const ENF_CATEGORY = id(NS.enf, "category"); // activity category for the warning
export const ENF_NOTE = id(NS.enf, "note"); // open optional-note modal
export const ENF_NOTE_MODAL = id(NS.enf, "noteModal"); // note modal submit
export const ENF_SEND = id(NS.enf, "send"); // dispatch to everyone selected
export const ENF_CLEAR = id(NS.enf, "clear"); // clear the current selection

// Staff activity log (/activity) — multi-member + category + points.
export const ACT_SELECT = id(NS.act, "select");
export const ACT_CATEGORY = id(NS.act, "category");
export const ACT_POINTS = id(NS.act, "points");
export const ACT_POINTS_MODAL = id(NS.act, "pointsModal");
export const ACT_CLEAR = id(NS.act, "clear");
export const ACT_SUBMIT = id(NS.act, "submit");

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

// Roblox Hub — state is keyed by message id; customIds stay short.
export const RBX_NAV = (view: string) => id(NS.rbx, "nav", view);
export const RBX_PAGE = (dir: "prev" | "next") => id(NS.rbx, "page", dir);
export const RBX_REFRESH = id(NS.rbx, "refresh");
export const RBX_SEARCH = id(NS.rbx, "search");
export const RBX_SEARCH_MODAL = id(NS.rbx, "searchModal");
export const RBX_AVATAR_VIEW = id(NS.rbx, "avatarView"); // string select
export const RBX_PICK_FRIEND = id(NS.rbx, "pickFriend"); // string select
export const RBX_PICK_GAME = id(NS.rbx, "pickGame"); // string select
export const RBX_BACK = id(NS.rbx, "back");
export const RBX_OPEN_PROFILE = id(NS.rbx, "extProfile"); // link-style handled as button → content
export const RBX_MILITARY = id(NS.rbx, "nav", "military");

// Game Intelligence / Scout Hub — separate from Roblox player hub
export const SCT_NAV = (view: string) => id(NS.scout, "nav", view);
export const SCT_PAGE = (dir: "prev" | "next") => id(NS.scout, "page", dir);
export const SCT_REFRESH = id(NS.scout, "refresh");
export const SCT_SEARCH = id(NS.scout, "search");
export const SCT_SEARCH_MODAL = id(NS.scout, "searchModal");
export const SCT_PICK_GAME = id(NS.scout, "pickGame");
export const SCT_BACK = id(NS.scout, "back");
export const SCT_SNAPSHOT = id(NS.scout, "snap");
export const SCT_GENRE_MODAL = id(NS.scout, "genreModal");
export const SCT_COMPARE_MODAL = id(NS.scout, "compareModal");
export const SCT_DEVEX_MODAL = id(NS.scout, "devexModal");
export const SCT_TOOLS = id(NS.scout, "tools"); // string select of secondary tools

// Marketplace Hub — avatar items (not Creator Store)
export const MKT_NAV = (view: string) => id(NS.mkt, "nav", view);
export const MKT_CAT = (cat: string) => id(NS.mkt, "cat", cat);
export const MKT_PRICE = (price: string) => id(NS.mkt, "price", price);
export const MKT_SORT = (sort: string) => id(NS.mkt, "sort", sort);
export const MKT_PAGE = (dir: "prev" | "next") => id(NS.mkt, "page", dir);
export const MKT_REFRESH = id(NS.mkt, "refresh");
export const MKT_SEARCH = id(NS.mkt, "search");
export const MKT_SEARCH_MODAL = id(NS.mkt, "searchModal");
export const MKT_CREATOR_MODAL = id(NS.mkt, "creatorModal");
export const MKT_PICK = id(NS.mkt, "pick");
export const MKT_BACK = id(NS.mkt, "back");
export const MKT_MORE = id(NS.mkt, "more");
export const MKT_CAT_MENU = id(NS.mkt, "catMenu"); // string select of categories
export const MKT_PRICE_MENU = id(NS.mkt, "priceMenu");

// Avatar link hub — assign a Roblox face to a Discord member's clan cards.
export const LNK_SEARCH_DISCORD = id(NS.link, "searchDiscord");
export const LNK_SEARCH_ROBLOX = id(NS.link, "searchRoblox");
export const LNK_DISCORD_MODAL = id(NS.link, "discordModal");
export const LNK_ROBLOX_MODAL = id(NS.link, "robloxModal");
export const LNK_PICK_ROBLOX = id(NS.link, "pickRoblox");
export const LNK_CONFIRM = id(NS.link, "confirm");
export const LNK_SKIP = id(NS.link, "skip");
export const LNK_CLEAR = id(NS.link, "clear");
export const LNK_ROLE = id(NS.link, "role");
export const LNK_ROLE_PICK = id(NS.link, "rolePick");
export const LNK_REFRESH = id(NS.link, "refresh");
export const LNK_HOME = id(NS.link, "home");

// Leveling / service-order queue
export const SVC_PLACE = id(NS.svc, "place");
export const SVC_SERVICE_PICK = id(NS.svc, "servicePick");
export const svcDetailsModal = (serviceKey: string) => id(NS.svc, "details", serviceKey);
export const svcClaim = (orderId: number) => id(NS.svc, "claim", orderId);
export const svcStart = (orderId: number) => id(NS.svc, "start", orderId);
export const svcHold = (orderId: number) => id(NS.svc, "hold", orderId);
export const svcComplete = (orderId: number) => id(NS.svc, "complete", orderId);
export const svcReject = (orderId: number) => id(NS.svc, "reject", orderId);
export const svcCancel = (orderId: number) => id(NS.svc, "cancel", orderId);
export const svcQueue = (orderId: number) => id(NS.svc, "queue", orderId);
export const svcUp = (orderId: number) => id(NS.svc, "up", orderId);
export const svcDown = (orderId: number) => id(NS.svc, "down", orderId);
export const svcSyncFiles = (orderId: number) => id(NS.svc, "syncFiles", orderId);
export const svcQuickReply = (orderId: number) => id(NS.svc, "quickReply", orderId);

