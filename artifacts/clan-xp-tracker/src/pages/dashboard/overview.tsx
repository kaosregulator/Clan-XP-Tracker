import { useQuery } from "@tanstack/react-query";
import {
  getGetClanStatsQueryOptions,
  getGetLeaderboardQueryOptions,
  getGetRecentActivityQueryOptions,
} from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { formatXP, formatRelativeTime } from "@/lib/utils";
import { Trophy, Users, FileCheck, TrendingUp, Activity } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface Props {
  guildId: string;
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function OverviewPage({ guildId }: Props) {
  const { data: stats } = useQuery(getGetClanStatsQueryOptions(guildId));
  const { data: topMembers } = useQuery(
    getGetLeaderboardQueryOptions(guildId, { period: "weekly", limit: 5 }),
  );
  const { data: activity } = useQuery(
    getGetRecentActivityQueryOptions(guildId, { limit: 8 }),
  );

  const chartData = stats?.xpChart?.slice(-7).map((point) => ({
    date: new Date(point.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    xp: point.xp,
  }));

  return (
    <DashboardLayout guildId={guildId} currentPath="">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Overview</h1>
          <p className="text-muted-foreground text-sm">Clan activity at a glance</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Members"
            value={stats?.totalMembers ?? "—"}
            icon={Users}
          />
          <StatCard
            label="Total XP (All Time)"
            value={stats?.totalXpAllTime ? formatXP(stats.totalXpAllTime) : "—"}
            icon={TrendingUp}
          />
          <StatCard
            label="Active Today"
            value={stats?.activeToday ?? "—"}
            icon={FileCheck}
          />
          <StatCard
            label="XP This Week"
            value={stats?.totalXpWeek ? formatXP(stats.totalXpWeek) : "—"}
            icon={Trophy}
            sub={stats?.activeThisWeek ? `${stats.activeThisWeek} active members` : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-card border border-card-border rounded-xl p-5">
            <h2 className="text-base font-semibold mb-4">XP This Week (Daily)</h2>
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(223 16% 18%)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "hsl(210 10% 55%)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(210 10% 55%)" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => formatXP(v)}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(223 20% 11%)",
                      border: "1px solid hsl(223 16% 20%)",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    formatter={(v: number) => [formatXP(v), "XP"]}
                  />
                  <Bar dataKey="xp" fill="hsl(235 86% 65%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No data yet
              </div>
            )}
          </div>

          <div className="bg-card border border-card-border rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold">Recent Activity</h2>
            </div>
            {activity && activity.length > 0 ? (
              <div className="space-y-3">
                {activity.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 text-sm">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground leading-snug">{item.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(item.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No recent activity
              </div>
            )}
          </div>
        </div>

        {topMembers && topMembers.length > 0 && (
          <div className="bg-card border border-card-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Weekly Leaders</h2>
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => (window.location.href = `/dashboard/${guildId}/leaderboard`)}
              >
                Full leaderboard →
              </button>
            </div>
            <div className="space-y-2">
              {topMembers.map((m, i) => (
                <div
                  key={m.userId}
                  className="flex items-center gap-3 py-2 border-b border-border last:border-0"
                >
                  <span
                    className={`w-6 text-center text-sm font-bold ${
                      i === 0
                        ? "text-yellow-400"
                        : i === 1
                          ? "text-zinc-300"
                          : i === 2
                            ? "text-amber-600"
                            : "text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                    {(m.displayName ?? m.username)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.displayName ?? m.username}</p>
                  </div>
                  <span className="text-sm font-semibold text-primary">{formatXP(m.xp)}</span>
                  <span className="text-xs text-muted-foreground w-14 text-right">XP this wk</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
