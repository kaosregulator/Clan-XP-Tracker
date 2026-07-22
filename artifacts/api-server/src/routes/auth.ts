import { Router } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";

const router = Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "";
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI ?? "";

type ReqLike = {
  headers: {
    host?: string;
    "x-forwarded-host"?: string | string[];
    "x-forwarded-proto"?: string | string[];
  };
};

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * The OAuth redirect_uri MUST be identical between the /authorize step and the
 * /callback step, and MUST be registered in the Discord Developer Portal.
 *
 * Order of precedence:
 *  1. DISCORD_REDIRECT_URI — set this to your stable domain to pin it. Best for
 *     production so it never drifts.
 *  2. The request's own forwarded host — self-consistent by construction: the
 *     user is redirected back to the exact domain they started on. This is what
 *     keeps dev + deployed both working without the URI "changing" mid-flow.
 *
 * We deliberately do NOT derive from REPLIT_DEV_DOMAIN, which changes between
 * dev sessions and caused the redirect to flap.
 */
function getRedirectUri(req: ReqLike): string {
  if (DISCORD_REDIRECT_URI) return DISCORD_REDIRECT_URI;
  const proto = firstHeader(req.headers["x-forwarded-proto"]) ?? "https";
  const host = firstHeader(req.headers["x-forwarded-host"]) ?? req.headers.host;
  if (host) return `${proto}://${host}/api/auth/callback`;
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}/api/auth/callback`;
  }
  return "";
}

router.get("/auth/discord", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: getRedirectUri(req),
    response_type: "code",
    scope: "identify guilds",
    state,
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code) {
    res.redirect("/?error=no_code");
    return;
  }

  if (state !== req.session.oauthState) {
    res.redirect("/?error=invalid_state");
    return;
  }

  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: getRedirectUri(req),
      }),
    });

    if (!tokenRes.ok) {
      logger.error({ status: tokenRes.status }, "Discord token exchange failed");
      res.redirect("/?error=token_failed");
      return;
    }

    const tokenData = await tokenRes.json() as { access_token: string };

    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) {
      res.redirect("/?error=user_fetch_failed");
      return;
    }

    const discordUser = await userRes.json() as {
      id: string;
      username: string;
      discriminator: string;
      avatar: string | null;
    };

    req.session.discordUser = discordUser;
    req.session.accessToken = tokenData.access_token;
    req.session.userId = discordUser.id;
    delete req.session.oauthState;

    res.redirect("/auth/callback");
  } catch (err) {
    logger.error({ err }, "OAuth callback error");
    res.redirect("/?error=server_error");
  }
});

router.get("/auth/me", (req, res) => {
  if (!req.session?.discordUser) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { id, username, discriminator, avatar } = req.session.discordUser;
  const avatarUrl = avatar
    ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=256`
    : `https://cdn.discordapp.com/embed/avatars/${parseInt(discriminator) % 5}.png`;

  res.json({ id, username, discriminator, avatar, avatarUrl });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get("/auth/invite-url", (_req, res) => {
  if (!DISCORD_CLIENT_ID) {
    res.status(503).json({ error: "Bot not configured" });
    return;
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    scope: "bot applications.commands",
    permissions: "2147485696",
    integration_type: "0",
  });
  res.json({ inviteUrl: `https://discord.com/oauth2/authorize?${params}` });
});

export default router;
