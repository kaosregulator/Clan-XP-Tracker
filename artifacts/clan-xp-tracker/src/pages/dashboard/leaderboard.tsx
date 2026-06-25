import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getGetLeaderboardQueryOptions } from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { formatXP } from "@/lib/utils";
import { Trophy, Medal } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  guildId: string;
}

type Period = "daily" | "weekly" | "monthly" | "alltime";

const periods: { label: string; value: Period }[] = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "All Time", value: "alltime" },
];

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="w-5 h-5 text-yellow-400" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-zinc-300" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" />;
  return <span className="text-sm text-muted-foreground w-5 text-center">{rank}</span>;
}

export default function LeaderboardPage({ guildId }: Props) {
  const [period, setPeriod] = useState<Period>("weekly");

  const { data: entries, isLoading } = useQuery(
    getGetLeaderboardQueryOptions(guildId, { period, limit: 50 }),
  );

  return (
    <DashboardLayout guildId={guildId} currentPath="/leaderboard">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Leaderboard</h1>
          <p className="text-muted-foreground text-sm">Top clan members by XP earned</p>
        </div>

        <div className="flex gap-2 bg-muted/40 border border-border rounded-lg p-1 w-fit">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                period === p.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
                  <div className="w-5 h-5 bg-muted rounded" />
                  <div className="w-10 h-10 bg-muted rounded-full" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 bg-muted rounded w-32" />
                    <div className="h-2.5 bg-muted rounded w-24" />
                  </div>
                  <div className="h-4 bg-muted rounded w-16" />
                </div>
              ))}
            </div>
          ) : entries && entries.length > 0 ? (
            <div className="divide-y divide-border">
              {entries.map((entry, i) => (
                <div
                  key={entry.userId}
                  className={cn(
                    "flex items-center gap-4 p-4 transition-colors hover:bg-muted/20",
                    i < 3 && "bg-primary/5",
                  )}
                >
                  <div className="w-6 flex items-center justify-center shrink-0">
                    <RankBadge rank={entry.rank} />
                  </div>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                    {(entry.displayName ?? entry.username)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{entry.displayName ?? entry.username}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.submissions ?? 0} submissions
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-primary">{formatXP(entry.xp)}</p>
                    <p className="text-xs text-muted-foreground">XP</p>
                  </div>
                  {entry.change != null && entry.change !== 0 && (
                    <span className={`text-xs font-medium ${entry.change > 0 ? "text-green-400" : "text-red-400"}`}>
                      {entry.change > 0 ? `+${entry.change}` : entry.change}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-20 text-center text-muted-foreground">
              <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No entries yet for this period</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
