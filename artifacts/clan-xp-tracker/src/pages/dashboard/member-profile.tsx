import { useQuery } from "@tanstack/react-query";
import { getGetMemberQueryOptions, getGetSubmissionsQueryOptions } from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { formatXP, formatDate, formatRelativeTime } from "@/lib/utils";
import { ArrowLeft, FileCheck, AlertTriangle, Calendar } from "lucide-react";
import { useLocation } from "wouter";

interface Props {
  guildId: string;
  userId: string;
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg p-4 text-center">
      <p className="text-xl font-bold text-primary">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

export default function MemberProfilePage({ guildId, userId }: Props) {
  const [, navigate] = useLocation();

  const { data: profile, isLoading } = useQuery(
    getGetMemberQueryOptions(guildId, userId),
  );

  const { data: submissionsPage } = useQuery(
    getGetSubmissionsQueryOptions(guildId, { userId, limit: 10 }),
  );

  const member = profile?.member;
  const warnings = profile?.warnings ?? [];

  return (
    <DashboardLayout guildId={guildId} currentPath="/members">
      <div className="max-w-3xl mx-auto space-y-6">
        <button
          onClick={() => navigate(`/dashboard/${guildId}/members`)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Members
        </button>

        {isLoading ? (
          <div className="bg-card border border-card-border rounded-xl p-6 animate-pulse">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 rounded-full bg-muted" />
              <div className="space-y-2">
                <div className="h-5 bg-muted rounded w-40" />
                <div className="h-3 bg-muted rounded w-28" />
              </div>
            </div>
          </div>
        ) : member ? (
          <>
            <div className="bg-card border border-card-border rounded-xl p-6">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-2xl shrink-0">
                  {(member.displayName ?? member.username)[0]?.toUpperCase()}
                </div>
                <div className="flex-1">
                  <h1 className="text-xl font-bold">{member.displayName ?? member.username}</h1>
                  <p className="text-muted-foreground text-sm">@{member.username}</p>
                  {member.lastSubmittedAt && (
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Last active {formatRelativeTime(member.lastSubmittedAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-3 py-1 rounded-full">
                  <FileCheck className="w-3 h-3" />
                  {member.submissionsCount ?? 0} submissions
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBox label="Daily XP" value={formatXP(member.xpDaily ?? 0)} />
                <StatBox label="Weekly XP" value={formatXP(member.xpWeekly ?? 0)} />
                <StatBox label="Monthly XP" value={formatXP(member.xpMonthly ?? 0)} />
                <StatBox label="All Time XP" value={formatXP(member.xpAllTime ?? 0)} />
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <FileCheck className="w-4 h-4 text-primary" />
                <h2 className="font-semibold">Recent Submissions</h2>
              </div>
              {submissionsPage?.submissions && submissionsPage.submissions.length > 0 ? (
                <div className="divide-y divide-border">
                  {submissionsPage.submissions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-medium">{formatXP(s.xpEarned ?? 0)} XP</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {s.submittedAt ? formatRelativeTime(s.submittedAt) : "—"}
                        </p>
                      </div>
                      {s.deletedAt ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">
                          deleted
                        </span>
                      ) : s.editedAt ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">
                          edited
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">
                          submitted
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm py-4 text-center">
                  No submissions yet
                </p>
              )}
            </div>

            {warnings.length > 0 && (
              <div className="bg-card border border-card-border rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="w-4 h-4 text-destructive" />
                  <h2 className="font-semibold">Warnings ({warnings.length})</h2>
                </div>
                <div className="space-y-2">
                  {warnings.map((w) => (
                    <div key={w.id} className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 text-sm">
                      <p className="text-foreground">{w.reason}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Issued by {w.issuedByUsername ?? "Moderator"}
                        {w.issuedAt ? ` · ${formatRelativeTime(w.issuedAt)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="bg-card border border-card-border rounded-xl p-10 text-center">
            <p className="text-muted-foreground">Member not found</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
