// Usage: node analyze.mjs results.jsonl [more.jsonl ...]
// Session-level metrics per arm (and per region), with bootstrap 95% CIs on the median.
import { readFileSync } from "node:fs";

const sessions = process.argv.slice(2)
  .flatMap((f) => readFileSync(f, "utf8").split("\n"))
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((o) => o?.event === "session");

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const quantile = (a, q) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function ci(values) {
  if (values.length < 2) return "";
  const meds = [];
  for (let b = 0; b < 2000; b++) meds.push(median(values.map(() => values[Math.floor(rand() * values.length)])));
  return `[${Math.round(quantile(meds, 0.025))}–${Math.round(quantile(meds, 0.975))}]`;
}

function perSession(s) {
  const steady = s.steady ?? [];
  const all = [...(s.calls ?? []), ...steady, ...(s.write ?? [])];
  const ok = steady.filter((c) => c.ok).map((c) => c.ms);
  return {
    bootFailed: Boolean(s.error || s.boot?.error),
    burstMs: s.burst?.wallMs ?? null,
    burstOk: s.burst ? s.burst.ok / s.burst.of : 0,
    steadyP50: median(ok),
    steadyP95: quantile(ok, 0.95),
    success: all.length ? all.filter((c) => c.ok || /insufficient funds/.test(c.err ?? "")).length / all.length : 0,
    firstOk: s.boot?.firstOkMs ?? null,
    dead: steady.length > 0 && steady.filter((c) => c.ok).length === 0,
    failovers: (s.events ?? []).filter((e) => e.event === "failover").length,
  };
}

const groups = new Map();
for (const s of sessions) {
  const key = `${s.region} ${s.arm}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(perSession(s));
}

const fmt = (v) => (v == null ? "-" : Math.round(v));
const col = (rows, f) => rows.map(f).filter((v) => v != null);
console.log("region arm | n | boot failed | dead | burst ms (median [95% CI]) | steady p50 | steady p95 | success | first ok ms | failovers");
for (const [key, rows] of [...groups].sort()) {
  const burst = col(rows, (r) => r.burstMs), p50 = col(rows, (r) => r.steadyP50), p95 = col(rows, (r) => r.steadyP95), first = col(rows, (r) => r.firstOk);
  console.log([
    key, rows.length,
    rows.filter((r) => r.bootFailed).length,
    rows.filter((r) => r.dead).length,
    `${fmt(median(burst))} ${ci(burst)}`,
    `${fmt(median(p50))} ${ci(p50)}`,
    fmt(median(p95)),
    `${(100 * (median(rows.map((r) => r.success)) ?? 0)).toFixed(0)}%`,
    `${fmt(median(first))} ${ci(first)}`,
    rows.reduce((a, r) => a + r.failovers, 0),
  ].join(" | "));
}

// Verified-read arms: calls that went out unverified, and proofs retried on another provider.
const verified = sessions.filter((s) => s.unverified != null);
if (verified.length) {
  console.log("\nregion arm | n | calls | unverified | verify retries");
  const byKey = new Map();
  for (const s of verified) {
    const key = `${s.region} ${s.arm}`;
    const g = byKey.get(key) ?? { n: 0, calls: 0, unverified: 0, retries: 0 };
    g.n++;
    g.calls += (s.calls ?? []).length + (s.steady ?? []).length;
    g.unverified += s.unverified;
    g.retries += (s.events ?? []).filter((e) => e.event === "verify-retry").length;
    byKey.set(key, g);
  }
  for (const [key, g] of [...byKey].sort()) console.log([key, g.n, g.calls, g.unverified, g.retries].join(" | "));
}
