import { LedgerError } from "@/lib/db/store";

// Per-process defense; deployment-wide limits must also be enforced by the host.
const buckets = new Map<string, { count: number; expires: number }>();
const windowMs = 60_000;

export function limitAiRequests(uid: string, url: string, now = Date.now()) {
  const path = new URL(url).pathname;
  if (!path.startsWith("/api/maps/") && path !== "/api/vibes/seed" && !/^\/api\/slots\/[^/]+\/options$/.test(path)) return;
  const existing = buckets.get(uid);
  if (existing && existing.expires > now) {
    if (existing.count >= 20) throw new LedgerError("Too many AI requests. Try again in a minute.", 429);
    existing.count += 1;
    return;
  }
  // Expired users cannot make the limiter grow without bound.
  if (buckets.size >= 10_000) {
    for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
    if (buckets.size >= 10_000) throw new LedgerError("Too many requests. Try again in a minute.", 429);
  }
  buckets.set(uid, { count: 1, expires: now + windowMs });
}
