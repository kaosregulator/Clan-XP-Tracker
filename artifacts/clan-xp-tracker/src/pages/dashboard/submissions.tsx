import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetSubmissionsQueryOptions,
  useDeleteSubmission,
} from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { formatXP, formatRelativeTime } from "@/lib/utils";
import { FileCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  guildId: string;
}

export default function SubmissionsPage({ guildId }: Props) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery(
    getGetSubmissionsQueryOptions(guildId, { page, limit }),
  );

  const deleteSubmission = useDeleteSubmission({
    mutation: {
      onSuccess: () => qc.invalidateQueries(),
    },
  });

  function remove(id: number) {
    if (confirm("Delete this submission?")) {
      deleteSubmission.mutate({ guildId, submissionId: id });
    }
  }

  return (
    <DashboardLayout guildId={guildId} currentPath="/submissions">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Submissions</h1>
          <p className="text-muted-foreground text-sm">All XP submissions from clan members</p>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-4 py-2.5 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span>Member</span>
            <span>XP Earned</span>
            <span>Alts</span>
            <span>Submitted</span>
            <span>Actions</span>
          </div>

          {isLoading ? (
            <div className="divide-y divide-border">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-4 py-4 animate-pulse">
                  <div className="h-3 bg-muted rounded w-32" />
                  <div className="h-3 bg-muted rounded w-16" />
                  <div className="h-3 bg-muted rounded w-8" />
                  <div className="h-3 bg-muted rounded w-20" />
                  <div className="h-7 w-7 bg-muted rounded" />
                </div>
              ))}
            </div>
          ) : data?.submissions && data.submissions.length > 0 ? (
            <div className="divide-y divide-border">
              {data.submissions.map((s) => (
                <div key={s.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-4 px-4 py-3 items-center">
                  <div>
                    <p className="font-medium text-sm">{s.username ?? "Unknown"}</p>
                    {s.notes && (
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">{s.notes}</p>
                    )}
                  </div>
                  <span className="font-semibold text-primary text-sm">{formatXP(s.xpEarned ?? 0)}</span>
                  <span className="text-sm text-muted-foreground">
                    {s.altAccountsCompleted > 0 ? `+${s.altAccountsCompleted}` : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.submittedAt ? formatRelativeTime(s.submittedAt) : "—"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {s.proofImageUrls && s.proofImageUrls.length > 0 && (
                      <a
                        href={s.proofImageUrls[0]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                        title="View proof"
                      >
                        Proof
                      </a>
                    )}
                    {!s.deletedAt && (
                      <button
                        onClick={() => remove(s.id)}
                        title="Delete"
                        className="text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {s.deletedAt && (
                      <span className="text-xs text-muted-foreground italic">deleted</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground">
              <FileCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No submissions found</p>
            </div>
          )}
        </div>

        {data && data.total > limit && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * limit >= data.total}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
