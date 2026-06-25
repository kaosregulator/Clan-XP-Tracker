import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGetMembersQueryOptions } from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { formatXP, formatRelativeTime } from "@/lib/utils";
import { Users, Search, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";

interface Props {
  guildId: string;
}

export default function MembersPage({ guildId }: Props) {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery(
    getGetMembersQueryOptions(guildId, { page, limit, search: search || undefined }),
  );

  return (
    <DashboardLayout guildId={guildId} currentPath="/members">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Members</h1>
          <p className="text-muted-foreground text-sm">All clan members and their XP stats</p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search members…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-card border border-card-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span>Member</span>
            <span>Daily XP</span>
            <span>Weekly XP</span>
            <span>Monthly XP</span>
            <span>Last Active</span>
            <span></span>
          </div>

          {isLoading ? (
            <div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-4 border-b border-border animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-muted rounded-full" />
                    <div className="h-3 bg-muted rounded w-28" />
                  </div>
                  {[1, 2, 3].map((j) => <div key={j} className="h-3 bg-muted rounded w-16 self-center" />)}
                  <div className="h-3 bg-muted rounded w-20 self-center" />
                  <div className="w-4 h-4 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : data?.members && data.members.length > 0 ? (
            <div className="divide-y divide-border">
              {data.members.map((m) => (
                <button
                  key={m.userId}
                  onClick={() => navigate(`/dashboard/${guildId}/members/${m.userId}`)}
                  className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 text-left hover:bg-muted/20 transition-colors items-center"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                      {(m.displayName ?? m.username)[0]?.toUpperCase()}
                    </div>
                    <span className="font-medium text-sm truncate">{m.displayName ?? m.username}</span>
                  </div>
                  <span className="text-sm text-muted-foreground">{formatXP(m.xpDaily ?? 0)}</span>
                  <span className="text-sm font-medium text-primary">{formatXP(m.xpWeekly ?? 0)}</span>
                  <span className="text-sm text-muted-foreground">{formatXP(m.xpMonthly ?? 0)}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.lastSubmittedAt ? formatRelativeTime(m.lastSubmittedAt) : "Never"}
                  </span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>{search ? "No members match your search" : "No members yet"}</p>
            </div>
          )}
        </div>

        {data && data.total > limit && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40 hover:bg-muted/20 transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page * limit >= data.total}
                className="px-3 py-1.5 rounded-lg border border-border text-sm disabled:opacity-40 hover:bg-muted/20 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
