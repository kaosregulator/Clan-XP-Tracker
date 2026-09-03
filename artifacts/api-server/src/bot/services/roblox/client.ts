/**
 * RoZod client wrapper: retries, timeouts, rate-limit mapping, optional Open Cloud.
 *
 * Public classic APIs never require ROBLOX_CLOUD_KEY.
 * Open Cloud helpers stay behind hasOpenCloudKey() / requireOpenCloud().
 */
import { fetchApi, isAnyErrorResponse, configureServer } from "rozod";
import type { EndpointSchema } from "rozod";
import { logger } from "../../../lib/logger";
import { RobloxServiceError } from "./errors";

let configured = false;

export function ensureRobloxClient(): void {
  if (configured) return;
  configured = true;
  const cloudKey = process.env.ROBLOX_CLOUD_KEY?.trim();
  // Never configure cookies — public APIs only.
  if (cloudKey) {
    configureServer({ cloudKey });
    logger.info("RoZod configured with Open Cloud key");
  } else {
    // Still call configureServer so UA / retries are consistent.
    configureServer({});
    logger.info("RoZod configured for public Roblox APIs (no Open Cloud key)");
  }
}

export function hasOpenCloudKey(): boolean {
  return Boolean(process.env.ROBLOX_CLOUD_KEY?.trim());
}

export function requireOpenCloud(): void {
  if (!hasOpenCloudKey()) {
    throw new RobloxServiceError(
      "open_cloud_required",
      "ROBLOX_CLOUD_KEY is not set"
    );
  }
}

type AnyErrorLike = {
  status?: number;
  error?: string;
  message?: string;
  errors?: Array<{ message?: string; code?: number }>;
};

function classifyError(err: AnyErrorLike): RobloxServiceError {
  const status = err.status ?? 0;
  const msg =
    err.error ||
    err.message ||
    err.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
    JSON.stringify(err);

  if (status === 429) return new RobloxServiceError("rate_limited", msg);
  if (status === 404) return new RobloxServiceError("not_found", msg);
  if (status === 401 || status === 403) {
    return new RobloxServiceError("auth_required", msg);
  }
  // RoZod sometimes surfaces schema/transport failures as { code: 0, message: "" }.
  if (status >= 500 || status === 0) {
    return new RobloxServiceError("unavailable", msg);
  }
  return new RobloxServiceError("unavailable", msg);
}

/**
 * Call a RoZod endpoint with retries for transient failures.
 * Params typing is intentionally loose so optional RoZod defaults don't fight us.
 */
export async function rbxFetch<S extends EndpointSchema>(
  endpoint: S,
  params: Record<string, unknown> | undefined,
  opts: { retries?: number; cacheTime?: number; cacheKey?: string; timeoutMs?: number } = {}
): Promise<NonNullable<Awaited<ReturnType<typeof fetchApi<S>>>>> {
  ensureRobloxClient();
  const retries = opts.retries ?? 2;
  // Bound every attempt. Node's global fetch (undici) otherwise waits on its
  // ~5 min header/body timeout, so a single stalled Roblox host would freeze
  // the whole player card. The signal propagates through RoZod to fetch().
  const timeoutMs = opts.timeoutMs ?? 8_000;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const reqOpts = {
        retries: 0,
        retryDelay: 400,
        cacheTime: opts.cacheTime,
        cacheKey: opts.cacheKey,
      };
      // Attach the abort signal without widening reqOpts' inferred type, so
      // RoZod's fetchApi overload resolution is unchanged. The signal is spread
      // through to the underlying fetch() at runtime.
      (reqOpts as Record<string, unknown>).signal = AbortSignal.timeout(timeoutMs);

      const result = await fetchApi(
        endpoint,
        // RoZod's ExtractParams is strict; cast at the boundary.
        params as never,
        reqOpts
      );

      if (isAnyErrorResponse(result)) {
        const classified = classifyError(result as AnyErrorLike);
        if (
          classified.kind === "rate_limited" ||
          classified.kind === "unavailable"
        ) {
          lastErr = classified;
          if (attempt < retries) {
            await sleep(400 * (attempt + 1));
            continue;
          }
        }
        throw classified;
      }
      return result as NonNullable<typeof result>;
    } catch (err) {
      if (err instanceof RobloxServiceError) {
        lastErr = err;
        if (
          (err.kind === "rate_limited" || err.kind === "unavailable") &&
          attempt < retries
        ) {
          await sleep(400 * (attempt + 1));
          continue;
        }
        throw err;
      }
      lastErr = err;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    }
  }

  if (lastErr instanceof RobloxServiceError) throw lastErr;
  throw new RobloxServiceError(
    "unavailable",
    lastErr instanceof Error ? lastErr.message : String(lastErr)
  );
}

/** Official Roblox HTTP for the few public endpoints RoZod does not expose. */
export async function rbxHttp<T>(
  url: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "ClanXP-RobloxHub/1.0",
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 429) {
      throw new RobloxServiceError("rate_limited", `HTTP 429 ${url}`);
    }
    if (res.status === 404) {
      throw new RobloxServiceError("not_found", `HTTP 404 ${url}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new RobloxServiceError("auth_required", `HTTP ${res.status} ${url}`);
    }
    if (!res.ok) {
      throw new RobloxServiceError("unavailable", `HTTP ${res.status} ${url}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof RobloxServiceError) throw err;
    throw new RobloxServiceError(
      "unavailable",
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString("en-US");
}
