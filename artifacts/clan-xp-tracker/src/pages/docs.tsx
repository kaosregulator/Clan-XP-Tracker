import { Trophy, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const COMMANDS: [string, string][] = [
  ["/setup", "Staff-only setup wizard — configure everything through menus, modals and channel/role pickers."],
  ["/xp", "The member hub: status, streak, warnings, daily goal, plus Open Game / Submit / My Progress / History."],
  ["/xpadmin", "The staff operations hub: today's progress, pending reviews, missing members, leaderboard."],
  ["/profile [user]", "A canvas profile card with streaks, approval %, warnings and recent activity."],
  ["/leaderboard", "The current streak leaderboard."],
  ["/warnings [user]", "View warnings; staff can remove them from a menu."],
  ["/report [period]", "Staff weekly/monthly activity report card."],
  ["/help", "Quick how-it-works for members and staff."],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-8 border-t border-border">
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      <div className="text-muted-foreground leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between max-w-4xl mx-auto">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Trophy className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">ClanXP Docs</span>
          </div>
        </Link>
        <Link href="/">
          <Button variant="ghost" className="gap-2">
            <ChevronLeft className="w-4 h-4" />
            Home
          </Button>
        </Link>
      </nav>

      <main className="max-w-4xl mx-auto px-6 pb-20">
        <section className="py-12">
          <h1 className="text-4xl font-extrabold tracking-tight mb-4">Documentation</h1>
          <p className="text-lg text-muted-foreground">
            ClanXP is a Discord-first daily activity &amp; XP tracker. Members prove daily activity with a
            screenshot; staff review it; streaks, warnings, reminders and dashboards update automatically.
            It's Roblox-first by default but works for any game.
          </p>
        </section>

        <Section title="1. Add the bot & run /setup">
          <p>
            Invite the bot from the home page, then run <Code>/setup</Code> (needs Manage Server). The wizard
            configures your community name, activity name (XP, Attendance, Missions…), daily goal, game link,
            timezone &amp; reset time, reminder schedule, channels, staff &amp; warning roles, optional alt
            accounts, and dashboards. It can auto-create the channels for you.
          </p>
          <p>
            The bot needs the <strong>Message Content</strong> privileged intent (Discord Developer Portal) so
            it can read screenshots posted in the submission channel.
          </p>
        </Section>

        <Section title="2. Member workflow">
          <p>
            A member opens <Code>/xp</Code>, optionally taps <strong>Open Game</strong>, plays, then taps{" "}
            <strong>Submit</strong> and posts a screenshot in the submission channel. That's it — their hub
            updates once staff approve.
          </p>
        </Section>

        <Section title="3. Review queue">
          <p>
            Each submission becomes an interactive card in the private review channel with{" "}
            <strong>Approve</strong>, <strong>Reject</strong>, <strong>Remind</strong>, <strong>Warn</strong>,{" "}
            <strong>User History</strong> and <strong>View Screenshot</strong>. No moderation commands needed.
          </p>
        </Section>

        <Section title="4. Reminders vs. warnings">
          <p>
            <strong>Reminders</strong> are friendly nudges — never a warning. The bot can DM missing members
            automatically at your configured times, and alerts staff when the queue ages or many members are
            missing near reset. <strong>Warnings</strong> are separate: they raise the warning count, assign a
            configured role, log the moderator &amp; reason, and can DM the member.
          </p>
        </Section>

        <Section title="5. Dashboards">
          <p>
            Set a public <strong>Clan</strong> dashboard and a private <strong>Staff</strong> dashboard channel
            and the bot keeps a live canvas board updated in place — today's progress, top streaks, pending
            reviews and more.
          </p>
        </Section>

        <Section title="6. Patriot / Guardian (alt accounts)">
          <p>
            Enable alt accounts in setup (with an optional max). Members manage each account from{" "}
            <strong>My Accounts</strong> on their hub, and the Submit button lets them pick which account a
            screenshot is for. Each account tracks its day independently.
          </p>
        </Section>

        <Section title="Commands">
          <div className="space-y-2">
            {COMMANDS.map(([cmd, desc]) => (
              <div key={cmd} className="flex flex-col sm:flex-row sm:gap-4">
                <Code className="shrink-0 sm:w-40">{cmd}</Code>
                <span>{desc}</span>
              </div>
            ))}
          </div>
          <p className="pt-2">
            Everything else happens through buttons, menus and modals — the command surface stays tiny on
            purpose.
          </p>
        </Section>
      </main>
    </div>
  );
}

function Code({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={`px-1.5 py-0.5 rounded bg-muted text-foreground text-sm font-mono ${className}`}>
      {children}
    </code>
  );
}
