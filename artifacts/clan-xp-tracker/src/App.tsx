import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import GuildsPage from "@/pages/guilds";
import AuthCallbackPage from "@/pages/auth-callback";
import OverviewPage from "@/pages/dashboard/overview";
import LeaderboardPage from "@/pages/dashboard/leaderboard";
import MembersPage from "@/pages/dashboard/members";
import MemberProfilePage from "@/pages/dashboard/member-profile";
import SubmissionsPage from "@/pages/dashboard/submissions";
import WarningsPage from "@/pages/dashboard/warnings";
import AuditPage from "@/pages/dashboard/audit";
import SettingsPage from "@/pages/dashboard/settings";
import SetupPage from "@/pages/dashboard/setup";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err: unknown) => {
        if (typeof err === "object" && err !== null && "status" in err) {
          const status = (err as { status: number }).status;
          if (status === 401 || status === 403 || status === 404) return false;
        }
        return count < 2;
      },
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/guilds" component={GuildsPage} />
      <Route path="/auth/callback" component={AuthCallbackPage} />

      <Route path="/dashboard/:guildId">
        {(params) => <OverviewPage guildId={params.guildId} />}
      </Route>
      <Route path="/dashboard/:guildId/setup">
        {(params) => <SetupPage guildId={params.guildId} />}
      </Route>
      <Route path="/dashboard/:guildId/leaderboard">
        {(params) => <LeaderboardPage guildId={params.guildId} />}
      </Route>
      <Route path="/dashboard/:guildId/members">
        {(params) => <MembersPage guildId={params.guildId} />}
      </Route>
      <Route path="/dashboard/:guildId/members/:userId">
        {(params) => <MemberProfilePage guildId={params.guildId} userId={params.userId} />}
      </Route>
      <Route path="/dashboard/:guildId/submissions">
        {(params) => <SubmissionsPage guildId={params.guildId} />}
      </Route>
      <Route path="/dashboard/:guildId/warnings">
        {(params) => <WarningsPage guildId={params.guildId} />}
      </Route>
      <Route path="/dashboard/:guildId/audit">
        {(params) => <AuditPage guildId={params.guildId} />}
      </Route>
      <Route path="/dashboard/:guildId/settings">
        {(params) => <SettingsPage guildId={params.guildId} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
