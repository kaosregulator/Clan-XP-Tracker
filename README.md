# 🎮 Clan XP Tracker

A **Discord-first daily activity & XP tracker** designed for gaming clans and communities. Members prove daily activity by posting screenshots, which the bot forwards to a staff review queue for quick approval. Built with TypeScript, React, Express, and PostgreSQL.

![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Status](https://img.shields.io/badge/Status-Active-brightgreen)

## ✨ Features

- **Discord-Native Interface**: Slash commands, interactive cards, modal submissions — no web browser needed
- **Screenshot Submission**: Members submit daily activity with screenshots to prove engagement
- **Staff Review Queue**: Interactive review cards let moderators approve/deny submissions instantly
- **Leaderboard Tracking**: Daily, weekly, monthly, and all-time XP leaderboards
- **Member Profiles**: View member stats, streaks, and contribution history
- **Automated Reminders**: Scheduled notifications to encourage daily participation
- **Warning System**: Track and manage member infractions with full audit logging
- **Clan Analytics**: Dashboard with stats, charts, and contribution tracking
- **Fully Configurable**: Customize activity names, game names, and visual themes per server
- **Multi-Game Support**: Built for Roblox by default but works with any game/community
- **Contribution Model**: Configurable clan contribution system with capacity limits
- **Canvas Rendering**: Beautiful, branded card designs with custom fonts

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
   - Select scopes: `bot`
   - Select permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Add Reactions`
   - Visit the generated URL and authorize

7. **Run the `/setup` command** in your Discord server to configure the bot

## 📚 Commands

### Member Commands
- `/xp` — View your XP, streaks, and submissions
- `/leaderboard [period]` — View XP leaderboards (daily, weekly, monthly, alltime)
- `/profile [@member]` — View a member's profile and history
- `/report [@member]` — Report a member to staff

### Staff Commands
- `/xpadmin` — Access the staff review hub
- `/warnings [@member]` — View and manage member warnings
- `/leaderboard [period]` — Full admin dashboard

### Admin Commands
- `/setup` — Configure the bot for your clan (identity, appearance, rules)

## 📂 Project Structure

```
Clan-XP-Tracker/
├── artifacts/
│   ├── api-server/           # Express API + Discord Bot
│   │   ├── src/
│   │   │   ├── bot/          # Discord.js bot & commands
│   │   │   │   ├── canvas/   # Card rendering engine
│   │   │   │   ├── features/ # Feature workflows (submit, review, etc)
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

All configuration is server-specific and managed via the `/setup` command:

- **Clan Name** — Your clan or community name
- **Activity Name** — Custom name for XP (default: "XP")
- **Game Name** — Game or community identifier (default: "Roblox")
- **Game URL** — Button link for members
- **Submission Channel** — Where members post screenshots
- **Review Channel** — Where staff review submissions
- **Tracker Channel** — Auto-updating contribution tracker embed
- **Auto-Approve** — Instant approval or staff queue
- **Contribution Model** — XP per submission, capacity limits, alts system
- **Theme & Colors** — Customizable card designs

## 📊 Data Model

### Core Tables

- **clans** — Clan configuration and settings
- **clan_members** — Member records with XP, streaks, warnings
- **xp_submissions** — Daily submissions with screenshot metadata
- **warnings** — Member infractions and history
- **audit_logs** — Full action audit trail
- **sessions** — Express session data

### Key Concepts

- **Contributions** — Weighted submissions (1 + alts) worth configurable XP
- **Clan Capacity** — Daily limit on total contributions or XP
- **Streaks** — Consecutive days of submission activity
- **Extraction** — Pluggable screenshot analysis (OCR/game verification)

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
- Discord bot token with Message Content intent

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

- **Database Push Required**: After pulling, run `pnpm --filter @workspace/db run push` to create new schema
- **Message Content Intent**: Required in Discord Developer Portal for screenshot reading
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
