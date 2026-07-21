import { db, trackedAccountsTable, xpSubmissionsTable, clanMembersTable } from "@workspace/db";
import type { Clan, TrackedAccount } from "@workspace/db";
import { eq, and, isNull, asc, desc } from "drizzle-orm";
import { activityDate } from "./time";

export type AccountState = "done" | "pending" | "missing";

/** Ensure the member has at least a Main account row. Returns all active accounts. */
export async function ensureAccounts(guildId: string, userId: string): Promise<TrackedAccount[]> {
  const rows = await listAccounts(guildId, userId);
  if (rows.length) return rows;
  await db.insert(trackedAccountsTable).values({ guildId, userId, label: "Main", isMain: true });
  return listAccounts(guildId, userId);
}

export async function listAccounts(guildId: string, userId: string): Promise<TrackedAccount[]> {
  return db
    .select()
    .from(trackedAccountsTable)
    .where(
      and(
        eq(trackedAccountsTable.guildId, guildId),
        eq(trackedAccountsTable.userId, userId),
        eq(trackedAccountsTable.active, true)
      )
    )
    .orderBy(desc(trackedAccountsTable.isMain), asc(trackedAccountsTable.id));
}

export interface AddAccountResult {
  ok: boolean;
  reason?: string;
  account?: TrackedAccount;
}

/** Add an alt account, respecting the clan's max (null = unlimited). */
export async function addAccount(clan: Clan, userId: string, label: string): Promise<AddAccountResult> {
  const existing = await listAccounts(clan.guildId, userId);
  const alts = existing.filter((a) => !a.isMain).length;
  if (clan.maxAltAccounts != null && alts >= clan.maxAltAccounts) {
    return { ok: false, reason: `You've reached the max of ${clan.maxAltAccounts} alt account(s).` };
  }
  const clean = label.trim().slice(0, 40) || `Alt ${alts + 1}`;
  if (existing.some((a) => a.label.toLowerCase() === clean.toLowerCase())) {
    return { ok: false, reason: `You already have an account labelled "${clean}".` };
  }
  const [account] = await db
    .insert(trackedAccountsTable)
    .values({ guildId: clan.guildId, userId, label: clean, isMain: false })
    .returning();
  return { ok: true, account };
}

/** Soft-remove an account (main accounts cannot be removed). */
export async function removeAccount(guildId: string, userId: string, accountId: number): Promise<boolean> {
  const [acc] = await db
    .select()
    .from(trackedAccountsTable)
    .where(and(eq(trackedAccountsTable.id, accountId), eq(trackedAccountsTable.guildId, guildId)));
  if (!acc || acc.userId !== userId || acc.isMain) return false;
  await db.update(trackedAccountsTable).set({ active: false }).where(eq(trackedAccountsTable.id, accountId));
  return true;
}

/** Today's completion state per account, for the hub grid. */
export async function accountStatesToday(
  clan: Clan,
  userId: string
): Promise<{ account: TrackedAccount; state: AccountState }[]> {
  const accounts = await ensureAccounts(clan.guildId, userId);
  const today = activityDate(clan);
  const subs = await db
    .select({ status: xpSubmissionsTable.status, accountId: xpSubmissionsTable.accountId })
    .from(xpSubmissionsTable)
    .where(
      and(
        eq(xpSubmissionsTable.guildId, clan.guildId),
        eq(xpSubmissionsTable.userId, userId),
        eq(xpSubmissionsTable.activityDate, today),
        isNull(xpSubmissionsTable.deletedAt)
      )
    );

  return accounts.map((account) => {
    // The main account also owns untagged (null) submissions from the simple flow.
    const mine = subs.filter(
      (s) => s.accountId === account.id || (account.isMain && s.accountId == null)
    );
    const state: AccountState = mine.some((s) => s.status === "approved")
      ? "done"
      : mine.some((s) => s.status === "pending")
        ? "pending"
        : "missing";
    return { account, state };
  });
}

export interface PatriotRow {
  userId: string;
  name: string;
  accounts: { label: string; state: AccountState }[];
}

export interface PatriotOverview {
  rows: PatriotRow[];
  members: number;
  totalAccounts: number;
  completedAccounts: number;
}

/**
 * Guild-wide view of members who manage multiple accounts (a non-main account),
 * with today's per-account state — powers the Patriot/Guardian dashboard.
 * Computed from two queries + in-memory grouping to avoid N+1.
 */
export async function patriotOverview(clan: Clan): Promise<PatriotOverview> {
  const today = activityDate(clan);
  const [accounts, subs, names] = await Promise.all([
    db
      .select()
      .from(trackedAccountsTable)
      .where(and(eq(trackedAccountsTable.guildId, clan.guildId), eq(trackedAccountsTable.active, true)))
      .orderBy(desc(trackedAccountsTable.isMain), asc(trackedAccountsTable.id)),
    db
      .select({
        userId: xpSubmissionsTable.userId,
        status: xpSubmissionsTable.status,
        accountId: xpSubmissionsTable.accountId,
      })
      .from(xpSubmissionsTable)
      .where(
        and(
          eq(xpSubmissionsTable.guildId, clan.guildId),
          eq(xpSubmissionsTable.activityDate, today),
          isNull(xpSubmissionsTable.deletedAt)
        )
      ),
    db
      .select({ userId: clanMembersTable.userId, displayName: clanMembersTable.displayName })
      .from(clanMembersTable)
      .where(eq(clanMembersTable.guildId, clan.guildId)),
  ]);

  const nameByUser = new Map(names.map((n) => [n.userId, n.displayName]));
  const byUser = new Map<string, TrackedAccount[]>();
  for (const a of accounts) {
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const stateFor = (userId: string, account: TrackedAccount): AccountState => {
    const mine = subs.filter(
      (s) => s.userId === userId && (s.accountId === account.id || (account.isMain && s.accountId == null))
    );
    if (mine.some((s) => s.status === "approved")) return "done";
    if (mine.some((s) => s.status === "pending")) return "pending";
    return "missing";
  };

  const rows: PatriotRow[] = [];
  let totalAccounts = 0;
  let completedAccounts = 0;
  for (const [userId, accs] of byUser) {
    // Patriots = members responsible for more than their single main account.
    if (accs.length < 2) continue;
    const accountStates = accs.map((a) => {
      const state = stateFor(userId, a);
      totalAccounts++;
      if (state === "done") completedAccounts++;
      return { label: a.label, state };
    });
    rows.push({ userId, name: nameByUser.get(userId) ?? "Unknown", accounts: accountStates });
  }

  // Most incomplete first, so staff see who needs attention.
  rows.sort(
    (a, b) =>
      a.accounts.filter((x) => x.state === "done").length / a.accounts.length -
      b.accounts.filter((x) => x.state === "done").length / b.accounts.length
  );

  return { rows, members: rows.length, totalAccounts, completedAccounts };
}
