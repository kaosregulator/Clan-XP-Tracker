import { Router } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger";

const router = Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "";

function getRedirectUri(req: { headers: { host?: string; "x-forwarded-proto"?: string } }) {
  const host = req.headers["x-forwarded-proto"]
    ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}`
    : `http://${req.headers.host}`;
  return `${host}/api/auth/callback`;
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
  });
  res.json({ inviteUrl: `https://discord.com/oauth2/authorize?${params}` });
});

export default router;
