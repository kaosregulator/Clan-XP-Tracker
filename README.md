# ⚔️ Clan XP Manager

A **staff-first Discord XP management tool** for gaming clans. Members do **not**
submit anything — **staff enter XP** while watching the game or a spreadsheet,
and the bot turns that into an organised calendar, history, reminder and
enforcement workflow. Built with TypeScript, React, Express, and PostgreSQL.

> **V3 note:** this bot is no longer an XP *submission / leaderboard* product.
> There is no screenshot submission, no review queue and no competitive
> ranking. It is a management tool for staff. (Earlier READMEs described the
> older submission model — this section is the current source of truth.)

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

## ✨ What it does

The bot is organised around a small number of **hubs**:

- **⚔️ XP Manager** (`/xp manage`) — a spreadsheet-style roster of every tracked
  member with category tabs (Complete / Attention / Missed / Reminded / Leave /
  Exempt / Excused), paging, and a click-through member panel to enter XP
  (incl. backdated), set status, remind, warn, remove warnings, adjust warning
  points and leave notes.
- **🔔 Notifications** (`/xp notifications`) — the actionable "what needs
  attention" queue with **Read** / **Clear** per item and a **View Members**
  jump; owners/staff also get a daily DM nudge.
- **⚠️ Warnings & Enforcement** (`/xp warnings`) — reminders, warnings, warning
  points, the enforcement role, remove-warning, warning history, member
  **disputes** and **tickets**, all in one place.
- **📅 Calendar** (`/calendar`) — the historical visual record of staff-entered
  XP, including backdated entries.
- **📊 Reports** (`/xp reports`) — a plain management summary (not a
  leaderboard) plus a full export.
- **⚙️ Setup** (`/xp setup`) — tracking role, goal, period, channels (choose or
  auto-create), staff/enforcement roles and thresholds.

Members get a deliberately tiny **/xp** view: their week, calendar, warnings,
history, and a **Something Wrong?** button to dispute a warning.

Key rules: completing XP **never** auto-removes a warning or the enforcement
role — enforcement stays staff-managed. Nothing here duplicates an existing
system; the hubs are operator surfaces over one XP ledger, one warning system,
one reminder system and one audit log.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 24+ and **pnpm**
- **PostgreSQL** database
- **Discord Bot** (create one at [Discord Developer Portal](https://discord.com/developers/applications))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/kaosregulator/Clan-XP-Tracker.git
   cd Clan-XP-Tracker
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Required variables:
   - `DATABASE_URL` — PostgreSQL connection string
   - `SESSION_SECRET` — Express session secret (generate with `openssl rand -hex 32`)
   - `DISCORD_BOT_TOKEN` — Your Discord bot token
   - `DISCORD_CLIENT_ID` — Discord application client ID
   - `DISCORD_CLIENT_SECRET` — Discord application client secret

4. **Push database schema**
   ```bash
   pnpm --filter @workspace/db run push
   ```

5. **Start development servers**
   ```bash
   # Terminal 1: API Server (runs on port 5000)
   pnpm --filter @workspace/api-server run dev

   # Terminal 2: React Frontend (runs on port 5173)
   pnpm --filter @workspace/clan-xp-tracker run dev
   ```

6. **Add the bot to your Discord server**
   - Go to Discord Developer Portal → OAuth2 → URL Generator
   - Select scopes: `bot`, `applications.commands`
   - Select permissions: `Send Messages`, `Embed Links`, `Attach Files`,
     `Manage Roles` (to assign the enforcement role), and optionally
     `Manage Channels` (to let setup auto-create the reminder/warning/log
     channels)
   - Enable the **Server Members Intent** in the Developer Portal (needed to
     resolve role membership for the roster and bulk actions). Message Content
     is **not** required.
   - Visit the generated URL and authorize

7. **Run `/xp setup`** in your Discord server to configure the bot

## 📚 Commands

### Member
- `/xp progress` — **MY XP**: your week, with buttons for My Calendar, My
  Warnings, My History and **Something Wrong?** (dispute a warning). Staff notes
  are delivered here once, then clear themselves.

### Officer hubs
- `/xp manage` — the **XP Manager** roster + member panel
- `/xp notifications` — what needs attention (Read / Clear)
- `/xp warnings` — the **Warnings & Enforcement** hub (disputes, tickets)
- `/xp reports` — weekly management summary + export
- `/xp review` · `/xp dashboard` — weekly review card & who's behind

### Officer quick actions (kept for compatibility)
- `/entry @user <amount> [date]` — log XP (rolls up + backfills the calendar)
- `/remind @user` · `/warn @user` — nudge / warn (warn is admin-only)
- `/calendar [@user] [month]` · `/missing [role]`
- `/xp set | add | remove | complete | reset | exempt | leave | note | goal`
- `/xp role add | reset | remind | warn | entry` — bulk by role

### Admin
- `/xp setup` (or `/setup`) — configure tracking role, goal, period, channels,
  staff/enforcement roles and thresholds

## 📂 Project Structure

```
Clan-XP-Tracker/
├── artifacts/
│   ├── api-server/           # Express API + Discord Bot
│   │   ├── src/
│   │   │   ├── bot/          # Discord.js bot & commands
│   │   │   │   ├── canvas/   # Card rendering engine
│   │   │   │   ├── features/ # Hubs & workflows (manager, warningsHub, memberView, notifications, setup…)
│   │   │   │   ├── services/ # DB & domain logic
│   │   │   │   └── ui/       # Component builders & customId registry
│   │   │   └── routes/       # API endpoints
│   │   └── build.mjs         # esbuild config
│   └── clan-xp-tracker/      # React + Vite frontend
│       └── src/
│           ├── pages/        # Landing, guilds, dashboard
│           └── components/   # React components
├── lib/
│   ├── api-spec/             # OpenAPI specification
│   ├── api-zod/              # Zod validation schemas (auto-generated)
│   ├── api-client-react/     # React Query hooks (auto-generated)
│   └── db/                   # Drizzle ORM schema
├── scripts/                  # Build & utility scripts
├── docs/                     # Documentation
└── pnpm-workspace.yaml       # Workspace configuration
```

## 🛠️ Development

### Build Commands

```bash
# Typecheck all packages
pnpm run typecheck

# Build all packages
pnpm run build

# Regenerate API hooks & schemas from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push database schema changes (dev only)
pnpm --filter @workspace/db run push
```

### Architecture Overview

- **Auth**: Discord OAuth2 + express-session (PostgreSQL-backed)
- **Database**: PostgreSQL + Drizzle ORM with full schema tracking
- **API**: Express 5 with Zod validation
- **Bot**: discord.js v14 with slash commands
- **Frontend**: React + Vite + Tailwind CSS
- **API Codegen**: Orval (generates from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- **Rendering**: Native canvas with bundled OFL fonts (Outfit, JetBrains Mono)

### Key Files

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — Database tables and relationships
- `artifacts/api-server/src/bot/commands.ts` — Command definitions
- `artifacts/api-server/src/bot/canvas/` — Card design templates
- `artifacts/clan-xp-tracker/src/pages/` — Web dashboard pages

## ⚙️ Configuration

All configuration is server-specific and managed via `/xp setup` (or `/setup`):

- **Tracking role** — the members the XP Manager manages (the roster). If 42
  people have it, the manager tracks 42. Distinct from the enforcement role.
- **Weekly goal / tracking mode** — exact numeric goal, complete/not-complete,
  or a small custom goal; plus an optional per-day target for the calendar.
- **Schedule** — timezone, week start day, reset time, reminder days/time.
- **Channels** — reminder, warning and log channels (choose existing or let the
  bot **create them for you**).
- **Roles** — officers, admins, exempt, on-leave, and the **enforcement role**
  auto-assigned on warn.
- **Thresholds** — warn after N reminders; leadership review at N warnings.

## 📊 Data Model

### Core Tables

- **clans** — per-guild configuration (tracking role, goal, schedule, channels,
  roles, thresholds)
- **clan_members** — member records: weekly progress, status flags
  (exempt / on-leave / **excused**), **warning points**, notes, counts
- **xp_entries** — the daily XP ledger (one row per member per day) that drives
  week/month/all-time totals and the calendar; supports backdating
- **xp_week_history** — archived per-member weekly outcomes for `/xp history`
- **warnings** — enforcement warnings and removal history
- **reminders** — every reminder sent (auto or manual)
- **disputes** — member warning disputes and their staff resolution
- **tickets** — lightweight staff tickets (escalated from disputes)
- **staff_notifications** — the Read/Clear notification queue
- **audit_logs** — full WHO/WHAT/WHEN/WHY action trail

### Key Concepts

- **Staff-entered XP** — officers enter XP; the bot records, rolls up and
  calendars it. Members never submit.
- **Tracking role vs enforcement role** — who is *managed* vs who has hit the
  reminder/warning threshold (`@Do Your XP`).
- **Warning points** — a staff-managed tally, separate from durable warnings;
  never auto-reset by completing XP.
- **Disputes → tickets** — members dispute a warning; staff accept / deny / ask
  for info / open a ticket.

> Some legacy tables and the older web dashboard (`xp_submissions`, leaderboard
> routes) remain in the repo for backward compatibility but are **not** part of
> the V3 staff-management product and are no longer written by the bot.

## 🎨 Customization

### Screenshot Data Extraction

The bot includes a pluggable seam for screenshot analysis in `artifacts/api-server/src/bot/services/extraction.ts`. By default it's a no-op, but you can:

1. Implement an OCR or game API integration
2. Call `setExtractor()` with your function
3. Results appear on review cards and in submission records

### Canvas Themes

Design custom card templates in `artifacts/api-server/src/bot/canvas/cards/`:

- Fully typed with canvas primitives (`text`, `rect`, `image`, etc)
- Access to member data, XP, streaks, and theme colors
- Bundled fonts: Outfit (UI) and JetBrains Mono (data)
- PNG export with transparent backgrounds

## 🐳 Deployment

### Railway

The repo includes `railway.json` and `railway.toml` for one-click Railway deployment. The bot works on Railway's free tier.

### Replit

Configured for Replit with `.replit` manifest (Node.js 24, pnpm):

```bash
pnpm --filter @workspace/api-server run dev
```

### Self-Hosted

Provide:
- PostgreSQL database (or Railway Postgres)
- Node.js 24+ with pnpm
- Discord bot token with the **Server Members** intent enabled

## 🧪 Testing & Validation

```bash
# Full workspace typecheck
pnpm run typecheck

# Typecheck specific package
pnpm --filter @workspace/api-server run typecheck

# Watch mode (development)
pnpm --filter @workspace/api-server run dev
```

All packages are strict TypeScript (`noUncheckedIndexedAccess`, `noImplicitAny`, etc).

## 📝 Important Notes

- **Database Push Required**: After pulling, run `pnpm --filter @workspace/db run push` to create new schema (V3 adds `disputes`, `tickets`, `staff_notifications` tables and `clan_members.warning_points` / `excused` columns)
- **Server Members Intent**: Required in the Discord Developer Portal so the bot can resolve role membership for the roster and bulk actions
- **Session Secret**: Generate a secure random value; never commit actual secrets
- **API Codegen**: After regenerating, `lib/api-zod/src/index.ts` must be manually restored (see gotchas in replit.md)
- **Canvas Fonts**: Always use bundled fonts; system fonts not available in containers
- **Workspace Typechecks**: `pnpm run typecheck` validates all packages before build

## 📖 Documentation

- `replit.md` — Detailed architecture, dev commands, gotchas
- `.env.example` — All configurable environment variables
- `lib/api-spec/openapi.yaml` — Complete API specification
- `lib/db/src/schema/` — Database structure and relationships

## 📋 Legal

- **[Terms of Service](./TERMS_OF_SERVICE.md)** — Please read before using the Service
- **[Privacy Policy](./PRIVACY_POLICY.md)** — How we handle your data

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes and test thoroughly
4. Submit a pull request with a clear description

Please ensure all TypeScript checks pass (`pnpm run typecheck`) before submitting.

## 📄 License

This project is licensed under the **MIT License** — see the LICENSE file for details.

## 🔗 Links

- **Live Demo**: https://replit.com/@guestacount107/Clan-XP-Tracker
- **GitHub**: https://github.com/kaosregulator/Clan-XP-Tracker
- **Discord**: [Add the bot to your server](https://discord.com/developers/applications)
- **Support**: Open an issue on GitHub

## 🙋 Support & Questions

- **Bug Reports**: Open an issue with reproduction steps
- **Feature Requests**: Discuss in issues or pull requests
- **Discord Questions**: Check the Discord community or replit.md

---

**Made with ❤️ for gaming communities**
