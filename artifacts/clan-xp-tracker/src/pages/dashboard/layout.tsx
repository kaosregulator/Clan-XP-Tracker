import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetMeQueryOptions,
  getGetClanQueryOptions,
  useLogout,
} from "@workspace/api-client-react";
import { useLocation, useRoute } from "wouter";
import { loginWithDiscord, getDiscordAvatarUrl, getGuildIconUrl } from "@/lib/auth";
import {
  LayoutDashboard,
  Trophy,
  Users,
  FileCheck,
  AlertTriangle,
  ClipboardList,
  Settings,
  ChevronLeft,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const navItems = [
  { label: "Overview", icon: LayoutDashboard, path: "" },
  { label: "Leaderboard", icon: Trophy, path: "/leaderboard" },
  { label: "Members", icon: Users, path: "/members" },
  { label: "Submissions", icon: FileCheck, path: "/submissions" },
  { label: "Warnings", icon: AlertTriangle, path: "/warnings" },
  { label: "Audit Log", icon: ClipboardList, path: "/audit" },
  { label: "Settings", icon: Settings, path: "/settings" },
];

interface Props {
  guildId: string;
  children: React.ReactNode;
  currentPath?: string;
}

export default function DashboardLayout({ guildId, children, currentPath = "" }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: user, isLoading: userLoading } = useQuery({
    ...getGetMeQueryOptions(),
    retry: false,
  });

  const { data: clan } = useQuery({
    ...getGetClanQueryOptions(guildId),
    enabled: !!user,
    retry: false,
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

  const sidebar = (
    <aside className="w-64 shrink-0 flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      <div className="p-4 border-b border-sidebar-border">
        <button
          onClick={() => navigate("/guilds")}
          className="flex items-center gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground text-sm mb-4 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          All Servers
        </button>

        {clan ? (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {clan.clanName?.[0] ?? "C"}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sidebar-foreground truncate text-sm">
                {clan.clanName}
              </p>
              <p className="text-xs text-sidebar-foreground/60 truncate">{clan.guildName}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-muted animate-pulse" />
            <div className="flex-1">
              <div className="h-3 bg-muted rounded animate-pulse mb-1.5" />
              <div className="h-2.5 bg-muted rounded animate-pulse w-3/4" />
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = currentPath === item.path;
          return (
            <button
              key={item.label}
              onClick={() => {
                navigate(`/dashboard/${guildId}${item.path}`);
                setMobileOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {user && (
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <img
              src={getDiscordAvatarUrl(user.id, user.avatar, 64)}
              alt={user.username}
              className="w-8 h-8 rounded-full object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user.username}
              </p>
              <p className="text-xs text-sidebar-foreground/50 truncate">@{user.username}</p>
            </div>
            <button
              onClick={() => logout.mutate(undefined)}
              title="Sign out"
              className="text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <div className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 z-10">
        {sidebar}
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-64 flex flex-col z-50">
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <span className="font-semibold">ClanXP</span>
        </div>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
