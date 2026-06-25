import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetWarningsQueryOptions,
  useIssueWarning,
  useRemoveWarning,
} from "@workspace/api-client-react";
import type { Warning } from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { formatRelativeTime } from "@/lib/utils";
import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  guildId: string;
}

export default function WarningsPage({ guildId }: Props) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const limit = 20;

  const { data, isLoading } = useQuery(
    getGetWarningsQueryOptions(guildId, { page, limit }),
  );

  const warnings = Array.isArray(data) ? data as Warning[] : [];

  const issueWarning = useIssueWarning({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries();
        setShowModal(false);
        setUserId("");
        setReason("");
      },
    },
  });

  const removeWarning = useRemoveWarning({
    mutation: {
      onSuccess: () => qc.invalidateQueries(),
    },
  });

  function handleIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim() || !reason.trim()) return;
    issueWarning.mutate({
      guildId,
      data: { userId: userId.trim(), reason: reason.trim() },
    });
  }

  return (
    <DashboardLayout guildId={guildId} currentPath="/warnings">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-1">Warnings</h1>
            <p className="text-muted-foreground text-sm">Manage member warnings</p>
          </div>
          <Button onClick={() => setShowModal(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            Issue Warning
          </Button>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border">
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-4 animate-pulse flex items-start gap-3">
                  <div className="w-8 h-8 bg-muted rounded-full" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-32" />
                    <div className="h-2.5 bg-muted rounded w-64" />
                  </div>
                </div>
              ))}
            </div>
          ) : warnings.length > 0 ? (
            <div className="divide-y divide-border">
              {warnings.map((w) => (
                <div key={w.id} className="flex items-start gap-3 p-4">
                  <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-sm">{w.username ?? w.userId}</p>
                      {w.removedAt ? (
                        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                          Removed
                        </span>
                      ) : (
                        <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{w.reason}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Issued by {w.issuedByUsername ?? "Moderator"}
                      {w.issuedAt ? ` · ${formatRelativeTime(w.issuedAt)}` : ""}
                    </p>
                  </div>
                  {!w.removedAt && (
                    <button
                      onClick={() => {
                        if (confirm("Remove this warning?")) {
                          removeWarning.mutate({ guildId, warningId: w.id });
                        }
                      }}
                      title="Remove warning"
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No warnings issued</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-2">Page {page}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={warnings.length < limit}>
            Next
          </Button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60" onClick={() => setShowModal(false)} />
          <div className="relative bg-card border border-card-border rounded-xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg">Issue Warning</h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleIssue} className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">Discord User ID</label>
                <input
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="e.g. 123456789012345678"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for warning…"
                  rows={3}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  required
                />
              </div>
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={issueWarning.isPending} className="bg-destructive hover:bg-destructive/90">
                  {issueWarning.isPending ? "Issuing…" : "Issue Warning"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
