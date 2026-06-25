import { useQuery } from "@tanstack/react-query";
import { getGetAuditLogsQueryOptions } from "@workspace/api-client-react";
import type { AuditLog } from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { formatRelativeTime } from "@/lib/utils";
import { ClipboardList, FileCheck, AlertTriangle, Settings, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Props {
  guildId: string;
}

const actionIcons: Record<string, React.ElementType> = {
  xp_submitted: FileCheck,
  warning_issued: AlertTriangle,
  warning_removed: Shield,
  setup_change: Settings,
};

const actionLabels: Record<string, string> = {
  xp_submitted: "XP Submitted",
  warning_issued: "Warning Issued",
  warning_removed: "Warning Removed",
  setup_change: "Setup Changed",
};

const actionColors: Record<string, string> = {
  xp_submitted: "text-primary bg-primary/10",
  warning_issued: "text-destructive bg-destructive/10",
  warning_removed: "text-green-400 bg-green-500/10",
  setup_change: "text-yellow-400 bg-yellow-500/10",
};

export default function AuditPage({ guildId }: Props) {
  const [page, setPage] = useState(1);
  const limit = 30;

  const { data, isLoading } = useQuery(
    getGetAuditLogsQueryOptions(guildId, { page, limit }),
  );

  const logs = Array.isArray(data) ? data as AuditLog[] : [];

  return (
    <DashboardLayout guildId={guildId} currentPath="/audit">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Audit Log</h1>
          <p className="text-muted-foreground text-sm">A complete history of all clan actions</p>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="divide-y divide-border">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-start gap-3 p-4 animate-pulse">
                  <div className="w-8 h-8 bg-muted rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-48" />
                    <div className="h-2.5 bg-muted rounded w-32" />
                  </div>
                  <div className="h-2.5 bg-muted rounded w-20" />
                </div>
              ))}
            </div>
          ) : logs.length > 0 ? (
            <div className="divide-y divide-border">
              {logs.map((log) => {
                const IconComp = actionIcons[log.action] ?? ClipboardList;
                const colorClass = actionColors[log.action] ?? "text-muted-foreground bg-muted";
                const label = actionLabels[log.action] ?? log.action;

                return (
                  <div key={log.id} className="flex items-start gap-3 p-4">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                      <IconComp className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{label}</span>
                        {log.targetUsername && (
                          <span className="text-sm text-muted-foreground">
                            → <span className="text-foreground">{log.targetUsername}</span>
                          </span>
                        )}
                      </div>
                      {log.moderatorUsername && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          By {log.moderatorUsername}
                        </p>
                      )}
                      {log.details && Object.keys(log.details).length > 0 && (
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                          {JSON.stringify(log.details)}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 mt-0.5">
                      {log.createdAt ? formatRelativeTime(log.createdAt) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No audit logs yet</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground px-2">Page {page}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={logs.length < limit}>
            Next
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
