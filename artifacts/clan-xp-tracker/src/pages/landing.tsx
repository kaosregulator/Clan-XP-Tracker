import { Shield, Trophy, BarChart3, Users, Zap, ChevronRight } from "lucide-react";
import { loginWithDiscord } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getGetMeQueryOptions } from "@workspace/api-client-react";
import { useLocation } from "wouter";

const features = [
  {
    icon: Trophy,
    title: "XP Leaderboards",
    description: "Real-time rankings across daily, weekly, monthly, and all-time periods.",
  },
  {
    icon: BarChart3,
    title: "Member Analytics",
    description: "Detailed submission history and XP growth trends for every member.",
  },
  {
    icon: Shield,
    title: "Warning System",
    description: "Issue and track warnings for members who violate clan rules.",
  },
  {
    icon: Users,
    title: "Clan Management",
    description: "Full audit logs, settings, and moderation tools for clan officers.",
  },
  {
    icon: Zap,
    title: "Discord Native",
    description: "Slash commands let members submit XP without ever leaving Discord.",
  },
];

export default function LandingPage() {
  const [, navigate] = useLocation();
  const { data: user } = useQuery({
    ...getGetMeQueryOptions(),
    retry: false,
  });

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
        <Button
          onClick={handleStart}
          variant="outline"
          className="gap-2"
        >
          {user ? "Go to Dashboard" : "Login with Discord"}
          <ChevronRight className="w-4 h-4" />
        </Button>
      </nav>

      <main className="max-w-7xl mx-auto px-6">
        <section className="py-24 text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary mb-8">
            <Zap className="w-3.5 h-3.5" />
            Track. Compete. Grow.
          </div>
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            Clan XP Tracking
            <br />
            <span className="text-primary">for Discord</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            A powerful XP tracker for your Discord clan. Submit daily XP, compete on leaderboards,
            and manage your community — all in one place.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button onClick={handleStart} size="lg" className="text-base px-8 gap-2">
              {user ? "Open Dashboard" : "Get Started with Discord"}
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="lg" className="text-base px-8">
              Learn More
            </Button>
          </div>
        </section>

        <section className="py-16 border-t border-border">
          <h2 className="text-3xl font-bold text-center mb-4">Everything your clan needs</h2>
          <p className="text-center text-muted-foreground mb-14 text-lg">
            Built for competitive Discord clans who take their XP seriously.
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
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-muted-foreground mb-8 text-lg">
            Add ClanXP to your Discord server and start tracking in minutes.
          </p>
          <Button onClick={handleStart} size="lg" className="text-base px-10">
            {user ? "Open Dashboard" : "Login with Discord"}
          </Button>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-8 text-center text-muted-foreground text-sm">
        <p>© {new Date().getFullYear()} ClanXP — Built for Discord communities.</p>
      </footer>
    </div>
  );
}
