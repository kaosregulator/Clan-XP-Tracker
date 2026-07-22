import {
  Shield,
  Trophy,
  Users,
  Zap,
  ChevronRight,
  Camera,
  Flame,
  Bell,
  LayoutDashboard,
  Gamepad2,
  BookOpen,
} from "lucide-react";
import { loginWithDiscord } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getGetMeQueryOptions } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";

const INVITE_FALLBACK =
  "https://discord.com/oauth2/authorize?client_id=1519561210024956015&scope=bot+applications.commands&permissions=2147871808";

async function inviteBot() {
  try {
    const res = await fetch("/api/auth/invite-url", { credentials: "include" });
    const data = (await res.json()) as { inviteUrl?: string };
    window.open(data.inviteUrl || INVITE_FALLBACK, "_blank");
  } catch {
    window.open(INVITE_FALLBACK, "_blank");
  }
}

const features = [
  {
    icon: LayoutDashboard,
    title: "Canvas Hubs",
    description:
      "Members open /xp, staff open /xpadmin — polished canvas interfaces, not plain embeds. It feels like an app inside Discord.",
  },
  {
    icon: Camera,
    title: "Screenshot Review Queue",
    description:
      "Members post proof; every submission becomes an interactive card for staff to approve, reject, remind, or warn.",
  },
  {
    icon: Flame,
    title: "Streaks & Profiles",
    description:
      "Automatic streaks, approval rates, submission history and warnings — a real player profile for every member.",
  },
  {
    icon: Bell,
    title: "Reminders, not Warnings",
    description:
      "Friendly automatic nudges when members forget, plus smart staff alerts when the queue backs up near reset.",
  },
  {
    icon: Gamepad2,
    title: "Any Game",
    description:
      "Roblox-first out of the box, but the game, link, and activity name are all configurable — Minecraft, Destiny, WoW, anything.",
  },
  {
    icon: Users,
    title: "Patriot / Guardian",
    description:
      "Members who run multiple accounts can track each one independently, with no hardcoded limit.",
  },
];

export default function LandingPage() {
  const [, navigate] = useLocation();
  const { data: user } = useQuery({ ...getGetMeQueryOptions(), retry: false });

  function handleStart() {
    if (user) navigate("/guilds");
    else loginWithDiscord();
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Trophy className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg tracking-tight">ClanXP</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/docs">
            <Button variant="ghost" className="gap-2">
              <BookOpen className="w-4 h-4" />
              Docs
            </Button>
          </Link>
          <Button onClick={handleStart} variant="outline" className="gap-2">
            {user ? "Dashboard" : "Login"}
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6">
        <section className="py-24 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary mb-8">
            <Zap className="w-3.5 h-3.5" />
            The Discord bot is the product
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            Daily activity tracking,
            <br />
            <span className="text-primary">inside Discord</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            Members prove their daily activity with a screenshot, staff approve it from a private review
            queue, and streaks, warnings and dashboards update automatically — all through beautiful
            canvas hubs. No spreadsheets, no manual tracking.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button onClick={inviteBot} size="lg" className="text-base px-8 gap-2">
              Add to Discord
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button onClick={handleStart} variant="outline" size="lg" className="text-base px-8">
              {user ? "Open Dashboard" : "Login with Discord"}
            </Button>
          </div>
        </section>

        <section className="py-16 border-t border-border">
          <h2 className="text-3xl font-bold text-center mb-4">Everything happens in Discord</h2>
          <p className="text-center text-muted-foreground mb-14 text-lg">
            A handful of commands, the rest through buttons, menus and canvas hubs.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f) => (
              <div
                key={f.title}
                className="bg-card border border-card-border rounded-xl p-6 hover-elevate"
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-16 text-center border-t border-border">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground mb-4">
            <Shield className="w-4 h-4" />
            Set up in minutes with the <code className="px-1.5 py-0.5 rounded bg-muted">/setup</code> wizard
          </div>
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-muted-foreground mb-8 text-lg">
            Add ClanXP to your server, run <code className="px-1.5 py-0.5 rounded bg-muted">/setup</code>, and
            you're tracking today.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button onClick={inviteBot} size="lg" className="text-base px-10">
              Add to Discord
            </Button>
            <Link href="/docs">
              <Button variant="outline" size="lg" className="text-base px-10">
                Read the docs
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-8 text-center text-muted-foreground text-sm">
        <p>© {new Date().getFullYear()} ClanXP — a Discord-first activity &amp; XP tracker.</p>
      </footer>
    </div>
  );
}
