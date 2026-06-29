import { useQuery } from "@tanstack/react-query";
import { getGetMeQueryOptions, getGetGuildsQueryOptions, customFetch } from "@workspace/api-client-react";
import { getGuildIconUrl } from "@/lib/auth";
import { useLocation } from "wouter";
import { Trophy, ChevronRight, Plus, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loginWithDiscord } from "@/lib/auth";
import { useLogout } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function GuildsPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: user, isLoading: userLoading } = useQuery({
    ...getGetMeQueryOptions(),
    retry: false,
  });

  const { data: guilds, isLoading: guildsLoading } = useQuery({
    ...getGetGuildsQueryOptions(),
    enabled: !!user,
  });

  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        qc.clear();
        window.location.href = "/";
      },
    },
  });

  if (!userLoading && !user) {
    loginWithDiscord();
    return null;
  }

  const isLoading = userLoading || guildsLoading;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/")}>
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Trophy className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg tracking-tight">ClanXP</span>
        </div>
        {user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {user.username}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate(undefined)}
              className="gap-2 text-muted-foreground"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </Button>
          </div>
        )}
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Select a Server</h1>
          <p className="text-muted-foreground">
            Choose a Discord server to manage your clan's XP tracker.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-card border border-card-border rounded-xl p-5 animate-pulse h-24" />
            ))}
          </div>
        ) : (
          <>
            {guilds && guilds.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {guilds.map((guild) => (
                  <button
                    key={guild.id}
                    onClick={() => navigate(`/dashboard/${guild.id}`)}
                    className="bg-card border border-card-border rounded-xl p-5 flex items-center gap-4 text-left hover-elevate hover:border-primary/50 transition-colors cursor-pointer"
                  >
                    <img
                      src={getGuildIconUrl(guild.id, guild.icon)}
                      alt={guild.name}
                      className="w-12 h-12 rounded-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://cdn.discordapp.com/embed/avatars/0.png`;
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{guild.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Member
                        {guild.isSetUp ? " · Clan active" : " · Not configured"}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="bg-card border border-card-border rounded-xl p-10 text-center mb-6">
                <p className="text-muted-foreground mb-2">No servers found.</p>
                <p className="text-sm text-muted-foreground">
                  Make sure you are in a Discord server and try again.
                </p>
              </div>
            )}

            <div className="bg-muted/40 border border-border rounded-xl p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                <Plus className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-medium">Add to another server</p>
                <p className="text-sm text-muted-foreground">
                  Invite the ClanXP bot to a new Discord server.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={async () => {
                try {
                  const res = await customFetch<{ inviteUrl: string }>('/api/auth/invite-url');
                  if (res.inviteUrl) window.open(res.inviteUrl, "_blank");
                } catch {
                  window.open("https://discord.com/oauth2/authorize?client_id=1519561210024956015&scope=bot+applications.commands&permissions=2147485696", "_blank");
                }
              }}>
                Invite Bot
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
