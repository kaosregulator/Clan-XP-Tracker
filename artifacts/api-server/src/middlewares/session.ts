import session from "express-session";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
  },
});

declare module "express-session" {
  interface SessionData {
    userId?: string;
    accessToken?: string;
    discordUser?: {
      id: string;
      username: string;
      discriminator: string;
      avatar: string | null;
    };
    oauthState?: string;
  }
}
