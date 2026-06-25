import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetClanQueryOptions,
  useUpdateClanSettings,
} from "@workspace/api-client-react";
import DashboardLayout from "./layout";
import { Settings, Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  guildId: string;
}

export default function SettingsPage({ guildId }: Props) {
  const qc = useQueryClient();
  const { data: clan, isLoading } = useQuery(getGetClanQueryOptions(guildId));

  const [clanName, setClanName] = useState("");
  const [proofRequired, setProofRequired] = useState(false);
  const [allowedRoleIds, setAllowedRoleIds] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (clan) {
      setClanName(clan.clanName ?? "");
      setProofRequired(clan.proofRequired ?? false);
      setAllowedRoleIds((clan.allowedRoleIds ?? []).join(", "));
    }
  }, [clan]);

  const updateSettings = useUpdateClanSettings({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries();
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      },
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const roleIds = allowedRoleIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    updateSettings.mutate({
      guildId,
      data: {
        clanName: clanName.trim() || undefined,
        proofRequired,
        allowedRoleIds: roleIds,
      },
    });
  }

  return (
    <DashboardLayout guildId={guildId} currentPath="/settings">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Settings</h1>
          <p className="text-muted-foreground text-sm">Configure your clan's XP tracker</p>
        </div>

        {isLoading ? (
          <div className="bg-card border border-card-border rounded-xl p-6 space-y-4 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <div className="h-3 bg-muted rounded w-32 mb-2" />
                <div className="h-10 bg-muted rounded" />
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <div className="bg-card border border-card-border rounded-xl p-6 space-y-5">
              <div className="flex items-center gap-2 pb-4 border-b border-border">
                <Settings className="w-4 h-4 text-primary" />
                <h2 className="font-semibold">General</h2>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Clan Name</label>
                <input
                  value={clanName}
                  onChange={(e) => setClanName(e.target.value)}
                  placeholder="Enter clan name…"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Allowed Role IDs</label>
                <input
                  value={allowedRoleIds}
                  onChange={(e) => setAllowedRoleIds(e.target.value)}
                  placeholder="Role IDs separated by commas…"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Discord role IDs allowed to use the /xp command. Leave empty to allow everyone.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Require Proof Screenshots</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Members must attach a screenshot when submitting XP
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={proofRequired}
                  onClick={() => setProofRequired((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                    proofRequired ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      proofRequired ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="bg-card border border-card-border rounded-xl p-6 space-y-3">
              <h2 className="font-semibold pb-4 border-b border-border">Bot Commands</h2>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p><code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">/xp submit</code> — Submit your daily XP</p>
                <p><code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">/xp leaderboard</code> — View the leaderboard</p>
                <p><code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">/xp profile @user</code> — View a member's profile</p>
                <p><code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">/xp setup</code> — Initial clan setup (admins only)</p>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={updateSettings.isPending}
                className={`gap-2 ${saved ? "bg-green-600 hover:bg-green-600" : ""}`}
              >
                {saved ? (
                  <>
                    <Check className="w-4 h-4" />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {updateSettings.isPending ? "Saving…" : "Save Changes"}
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
}
