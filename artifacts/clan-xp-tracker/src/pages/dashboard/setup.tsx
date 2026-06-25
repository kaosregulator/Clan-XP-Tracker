import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSetupClan } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Trophy, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  guildId: string;
}

export default function SetupPage({ guildId }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [clanName, setClanName] = useState("");
  const [proofRequired, setProofRequired] = useState(false);
  const [allowedRoleIds, setAllowedRoleIds] = useState("");

  const setupClan = useSetupClan({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries();
        setStep(3);
      },
    },
  });

  function handleFinish() {
    const roleIds = allowedRoleIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    setupClan.mutate({
      guildId,
      data: {
        clanName: clanName.trim(),
        proofRequired,
        allowedRoleIds: roleIds,
        allowedUserIds: [],
      },
    });
  }

  const steps = [
    { label: "Name your clan" },
    { label: "Configure rules" },
    { label: "Review & confirm" },
  ];

  if (step === 3) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-green-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Clan set up!</h1>
          <p className="text-muted-foreground mb-8">
            Your clan "{clanName}" is ready. Members can now use /xp in Discord to submit XP.
          </p>
          <Button onClick={() => navigate(`/dashboard/${guildId}`)}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-10">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Trophy className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg">ClanXP Setup</span>
        </div>

        <div className="flex items-center gap-2 mb-10">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  i <= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-sm ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div className={`w-8 h-px mx-1 ${i < step ? "bg-primary" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-card border border-card-border rounded-xl p-6 space-y-6">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold mb-1">Name your clan</h2>
                <p className="text-muted-foreground text-sm">This will appear on the leaderboard and dashboard.</p>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1.5">Clan Name</label>
                <input
                  value={clanName}
                  onChange={(e) => setClanName(e.target.value)}
                  placeholder="e.g. Dragon Warriors"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoFocus
                />
              </div>
              <Button onClick={() => setStep(1)} disabled={!clanName.trim()} className="gap-2">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold mb-1">Configure rules</h2>
                <p className="text-muted-foreground text-sm">Set submission rules for your clan.</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Require proof screenshots</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Members must attach a screenshot when submitting XP
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setProofRequired((v) => !v)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${proofRequired ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${proofRequired ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">Allowed Role IDs (optional)</label>
                <input
                  value={allowedRoleIds}
                  onChange={(e) => setAllowedRoleIds(e.target.value)}
                  placeholder="Role IDs separated by commas…"
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  Leave empty to allow all members.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(0)}>Back</Button>
                <Button onClick={() => setStep(2)} className="gap-2">
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold mb-1">Review & confirm</h2>
                <p className="text-muted-foreground text-sm">Check your settings before launching.</p>
              </div>

              <div className="bg-muted/30 rounded-lg p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Clan Name</span>
                  <span className="font-medium">{clanName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Proof Required</span>
                  <span className="font-medium">{proofRequired ? "Yes" : "No"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role Restrictions</span>
                  <span className="font-medium">{allowedRoleIds.trim() || "None (open to all)"}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={handleFinish} disabled={setupClan.isPending}>
                  {setupClan.isPending ? "Setting up…" : "Launch Clan"}
                </Button>
              </div>

              {setupClan.isError && (
                <p className="text-sm text-destructive">Failed to set up clan. Please try again.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
