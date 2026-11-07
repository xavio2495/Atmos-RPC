import { AnonRpcWorker } from "@anon-rpc/browser-harness";

export const NYM_SPECIFIER = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
// What the Nym worker needs from a harness that sets limits: about 1 GiB for its wasm, and its
// longest synchronous step measured 1.0–1.4 s (the first evaluation).
export const NYM_WORKER_LIMITS = { memoryBytes: 1 << 30, deadlineMs: 10_000 };
const NYM_APIS = ["https://validator.nymtech.net/api/v1"];
// The Nym worker bundle this client runs, pinned like Subresource Integrity. Moving to a new
// worker version is a client release, not a change any RPC provider or specifier owner can make.
const NYM_WORKER_HASH = "0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8";
const SEL_WORKER_HASH = "0x3898587d"; // workerHash()
const SEL_WORKER_RESOLVERS = "0x1c67ff29"; // workerResolvers()
// Where the pinned bundle is fetched from (the specifier's list for that hash). A stale entry
// costs availability, never integrity: the bytes must still hash to the pin.
const NYM_WORKER_RESOLVERS = [
  "https://cdn.jsdelivr.net/npm/@nymproject/anon-rpc-worker@0.1.0/dist/nym-anon-rpc-worker.js",
  "https://unpkg.com/@nymproject/anon-rpc-worker@0.1.0/dist/nym-anon-rpc-worker.js",
  "https://raw.githubusercontent.com/nymtech/anon-rpc-worker/keccak/f1/3a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8",
];
// The specifier lives on mainnet; the change-check asks this provider through the mixnet.
const SPECIFIER_RPC = "https://ethereum-rpc.publicnode.com";
const BOOT_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 24_000;
// A healthy call through Nym completes in well under this; past it, the route is treated as stalled.
const ATTEMPT_TIMEOUT_MS = 8_000;
// The first request a route makes to a host also pays DNS, TCP and TLS through the mixnet.
const FIRST_CONTACT_TIMEOUT_MS = 30_000;
// Known batch caps; any other provider's cap is learned from its first refusal.
const KNOWN_BATCH_CAPS = { "eth.drpc.org": 3, "rpc.flashbots.net": 5 };
// A replaced route stays open this long so requests already in flight on it can finish.
const RETIRE_GRACE_MS = 30_000;
const DEFAULT_MAX_BATCH = 10;
// Hedge delays come from this public set, so the gap between two copies of a call reveals little.
const HEDGE_DELAYS_MS = [250, 500, 750, 1000, 1500, 2000, 3000];
const HEDGE_WINDOW = 50;
const HEDGE_MIN_SAMPLES = 20;
// A standby that failed to boot is tried again after this long.
const STANDBY_RETRY_MS = 5_000;
const MAX_QUEUE_WAIT_SAMPLES = 1_000;
const MIN_BAND = 6;
// Large background fetches (e.g. a block's access list, 70–160 KB) get this long on their own lane.
const BULK_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function withTimeout(p, ms, what) {
  let timer;
  const expiry = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timeout`)), ms); });
  return Promise.race([p, expiry]).finally(() => clearTimeout(timer));
}
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const pick = (arr) => arr[crypto.getRandomValues(new Uint32Array(1))[0] % arr.length];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function nymList(api, path) {
  const j = await (await fetch(api + path)).json();
  return Array.isArray(j) ? j : (j.nodes?.data ?? j.data);
}

// The top performance band, or the best fifth of the list if the band is too small to choose from.
function band(nodes, eligible) {
  const ok = nodes.filter(eligible);
  const top = ok.filter((n) => Number(n.performance) >= 0.99);
  if (top.length >= MIN_BAND) return top;
  return ok.sort((a, b) => Number(b.performance) - Number(a.performance)).slice(0, Math.max(MIN_BAND, Math.ceil(ok.length / 5)));
}

function abiStringArray(strs) {
  const word = (n) => n.toString(16).padStart(64, "0");
  const bodies = strs.map((str) => {
    const h = [...new TextEncoder().encode(str)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, "0");
  });
  let offset = strs.length * 32, heads = "";
  for (const b of bodies) { heads += word(offset); offset += b.length / 2; }
  return "0x" + word(32) + word(strs.length) + heads + bodies.join("");
}

// The harness reads the specifier (worker hash and resolvers) with unproven eth_calls through the
// bootstrap provider, in the clear from the user's IP. Answering both from pins means a lying
// provider can't choose the code, and no provider learns that this IP is booting the worker.
// Any other call still goes to the provider.
function pinSpecifier(provider, address, hash, resolvers) {
  const answers = { [SEL_WORKER_HASH]: hash };
  if (resolvers) answers[SEL_WORKER_RESOLVERS] = abiStringArray(resolvers);
  return {
    request(args) {
      const call = args?.params?.[0];
      const pinned = args?.method === "eth_call" && call?.to?.toLowerCase() === address.toLowerCase() && answers[call?.data];
      return pinned ? Promise.resolve(pinned) : provider.request(args);
    },
  };
}

// Entry gateways and IPR exits from the public directory (the first API that answers), filtered
// to the top performance band. Choosing uniformly inside the band uses no client data.
async function loadBand(apis) {
  let last;
  for (const api of apis) {
    try {
      const [entries, exits, described] = await Promise.all([
        nymList(api, "/unstable/nym-nodes/skimmed/entry-gateways/all"),
        nymList(api, "/unstable/nym-nodes/skimmed/exit-gateways/all"),
        nymList(api, "/nym-nodes/described"),
      ]);
      const ipr = new Map(described.map((d) => [d.node_id, d.description?.ip_packet_router?.address]));
      return {
        apiHost: new URL(api).hostname,
        entries: band(entries, (g) => g.entry?.wss_port && g.entry?.hostname),
        exits: band(exits, (x) => ipr.get(x.node_id)).map((x) => ipr.get(x.node_id)),
        loadedAt: Date.now(),
      };
    } catch (e) { last = e; }
  }
  throw last;
}

function gatewayAnswers(g) {
  return new Promise((ok) => {
    let ws;
    try { ws = new WebSocket(`wss://${g.entry.hostname}:${g.entry.wss_port}`); } catch { return ok(false); }
    const t = setTimeout(() => { try { ws.close(); } catch {} ok(false); }, 5000);
    ws.onopen = () => { clearTimeout(t); ws.close(); ok(true); };
    ws.onerror = () => { clearTimeout(t); ok(false); };
  });
}

// padBytes > 0 pads the body with JSON whitespace to the next multiple of padBytes, so the
// request size seen past the exit says little about the calls inside it.
async function postJson(worker, url, body, padBytes = 0) {
  let text = JSON.stringify(body);
  if (padBytes > 0) text = text.padEnd(Math.ceil(text.length / padBytes) * padBytes, " ");
  const r = await worker.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  return r.json();
}

// One Nym worker plus a per-origin queue: at most one request in flight per
// origin, with everything that queued meanwhile sent as one JSON-RPC batch.
class Route {
  constructor(worker, { padBytes = 0, onWait = () => {}, caps = {}, exit = null, release = () => {} } = {}) {
    this.worker = worker;
    this.padBytes = padBytes;
    this.onWait = onWait;
    this.caps = caps;
    this.exit = exit;
    this.release = release;
    this.queues = new Map();
    this.chains = new Map();
    this.warm = new Set();
  }

  // Non-JSON-RPC requests (for example beacon-API GETs), one at a time per origin.
  fetch(url, init) {
    const origin = new URL(url).origin;
    const next = (this.chains.get(origin) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.worker.fetch(url, init));
    this.chains.set(origin, next);
    return next;
  }

  send(url, body) {
    return new Promise((resolve, reject) => {
      let q = this.queues.get(url);
      if (!q) { q = { pending: [], busy: false }; this.queues.set(url, q); }
      q.pending.push({ body, resolve, reject, at: performance.now() });
      // Let calls issued in the same tick join one batch.
      queueMicrotask(() => this.#drain(url, q));
    });
  }

  async #drain(url, q) {
    if (q.busy || q.pending.length === 0) return;
    q.busy = true;
    const host = new URL(url).host;
    const items = q.pending.splice(0, this.caps[host] ?? DEFAULT_MAX_BATCH);
    const now = performance.now();
    items.forEach((it) => this.onWait(now - it.at));
    try {
      if (items.length === 1) {
        items[0].resolve(await postJson(this.worker, url, items[0].body, this.padBytes));
      } else {
        const ids = items.map((_, i) => i + 1);
        const reply = await postJson(this.worker, url, items.map((it, i) => ({ ...it.body, id: ids[i] })), this.padBytes);
        // A batch refused for its size means the provider caps batches: learn a smaller cap, resend.
        if (!Array.isArray(reply) && (reply?.error?.code === -32014 || /batch/i.test(reply?.error?.message ?? ""))) {
          this.caps[host] = Math.max(1, Math.floor(items.length / 2));
          q.pending.unshift(...items);
          return;
        }
        const byId = new Map((Array.isArray(reply) ? reply : []).map((r) => [r.id, r]));
        items.forEach((it, i) => {
          const r = byId.get(ids[i]);
          if (r) it.resolve({ ...r, id: it.body.id });
          else it.reject(new Error("missing batch member"));
        });
      }
    } catch (e) {
      items.forEach((it) => it.reject(e));
    } finally {
      q.busy = false;
      this.#drain(url, q);
    }
  }

  busy(url) { return this.queues.get(url)?.busy ?? false; }

  close() {
    this.worker.close();
    this.release();
  }
}

// Cost-optimal hedge delay: the d that minimises mean(min(x, d + y)) + lambda * P(x > d) over recent
// latencies, where y is the standby's latency (same distribution). Infinity means don't hedge.
function hedgeDelay(latencies, lambdaMs) {
  const n = latencies.length;
  let best = Infinity, bestCost = latencies.reduce((a, x) => a + x, 0) / n;
  for (const d of HEDGE_DELAYS_MS) {
    let total = 0, hedged = 0;
    for (const x of latencies) {
      if (x <= d) { total += x; continue; }
      hedged++;
      for (const y of latencies) total += Math.min(x, d + y) / n;
    }
    const cost = total / n + lambdaMs * hedged / n;
    if (cost < bestCost) { best = d; bestCost = cost; }
  }
  return best;
}

// Options (all optional except bootstrapProvider and probeUrl):
//   hedgeLambdaMs: a slow read is also sent on the warm standby (a second exit sees it); larger
//     values hedge less. rotateMs: replace the primary route about this often, so no route lasts
//     long enough to become a timing fingerprint. overflow: a read that would queue behind a request
//     in flight goes to the warm standby instead (a second exit sees it).
//   tunnel: extra options for the worker's mix tunnel; options the exit can observe make the client
//     stand out. padBytes: pad every JSON-RPC request body to a multiple of this many bytes.
//   workerHash, workerResolvers: the worker bundle to run and where to fetch it (default: the pinned
//     Nym worker); with a custom hash and no resolvers, the resolvers are read from the specifier.
//   nymApis: Nym directory APIs, tried in order. specifierRpc: the mainnet provider the specifier
//     change-check asks, through the mixnet. bulkLanes: how many separate routes carry bulk() calls.
export async function createAtmosClient({
  bootstrapProvider, probeUrl, log = () => {}, Worker = AnonRpcWorker,
  hedgeLambdaMs = null, rotateMs = null, overflow = false, tunnel = {}, padBytes = 0,
  workerHash = NYM_WORKER_HASH, workerResolvers = workerHash === NYM_WORKER_HASH ? NYM_WORKER_RESOLVERS : null,
  nymApis = NYM_APIS, specifierRpc = SPECIFIER_RPC, bulkLanes = 1,
}) {
  if (Array.isArray(nymApis) === false || nymApis.length === 0) throw new TypeError("nymApis must be a non-empty list");
  let directory = await loadBand(nymApis);
  const rpcProvider = pinSpecifier(bootstrapProvider, NYM_SPECIFIER, workerHash, workerResolvers);
  const caps = { ...KNOWN_BATCH_CAPS };
  const queueWaits = [];
  const recordWait = (ms) => { queueWaits.push(Math.round(ms)); if (queueWaits.length > MAX_QUEUE_WAIT_SAMPLES) queueWaits.shift(); };
  // Exits of routes that are booting or alive; a new route takes any other exit in the band.
  const exitsInUse = new Set();
  let closed = false;

  async function bootRoute() {
    for (let attempt = 0; attempt < 4 && !closed; attempt++) {
      if (Date.now() - directory.loadedAt > 3_600_000) directory = await loadBand(nymApis).catch(() => directory);
      let entry = null;
      for (const g of shuffle(directory.entries).slice(0, 6)) {
        if (await gatewayAnswers(g)) { entry = g; break; }
      }
      const exit = pick(directory.exits.filter((x) => !exitsInUse.has(x)));
      if (!entry || !exit) continue;
      exitsInUse.add(exit);
      const release = () => exitsInUse.delete(exit);
      const worker = new Worker({
        address: NYM_SPECIFIER,
        // A pinned exit that hasn't answered the handshake in 15 s is dropped (the tunnel's default
        // is 60 s); a healthy handshake takes 1–3 s. Client-side only, so nothing the exit can see.
        config: { connectTimeoutMs: 15_000, ...tunnel, preferredGateway: entry.ed25519_identity_pubkey, preferredIpr: exit },
        preExisting: { rpcProvider },
        expectedHash: workerHash,
        // On harnesses that bridge the network (the Atmos Node harness), the worker may reach only
        // the Nym directory and its own entry gateway; everything else goes through the mixnet.
        network: { policy: { hosts: [directory.apiHost, entry.entry.hostname] } },
      });
      try {
        await withTimeout(worker.ready, BOOT_TIMEOUT_MS, "boot");
        const route = new Route(worker, { padBytes, onWait: recordWait, caps, exit, release });
        for (let probe = 0; probe < 2; probe++) {
          try {
            const r = await withTimeout(route.send(probeUrl, { jsonrpc: "2.0", id: 0, method: "eth_chainId", params: [] }), PROBE_TIMEOUT_MS, "probe");
            if (r?.result) {
              route.warm.add(new URL(probeUrl).origin);
              log({ event: "route-accepted", attempt, probe });
              return route;
            }
          } catch {}
        }
        log({ event: "route-rejected", attempt, reason: "probe" });
      } catch (e) {
        const reason = String(e?.message ?? e);
        log({ event: "route-rejected", attempt, reason });
        // A boot that failed fast (e.g. every bundle mirror unreachable) is retried after a pause, not at once.
        if (reason !== "boot timeout") { worker.close(); release(); await sleep(2_000 * 2 ** attempt); continue; }
      }
      worker.close();
      release();
    }
    throw new Error("no working route");
  }

  let primary = await bootRoute();
  let secondary = null;
  let replacing = null;
  let standbyRetry = null;
  const retiring = new Set();
  const retire = (route) => {
    retiring.add(route);
    setTimeout(() => { retiring.delete(route); route.close(); }, RETIRE_GRACE_MS);
  };
  // Origins the client has called. A standby connects to each before it can take over,
  // so the first calls after a failover don't pay DNS, TCP and TLS through the mixnet.
  const usedOrigins = new Set();
  const warmUp = (route) => Promise.all([...usedOrigins].filter((o) => !route.warm.has(o)).map((o) =>
    withTimeout(route.fetch(o + "/", { method: "HEAD" }), FIRST_CONTACT_TIMEOUT_MS, "warm-up")
      .then(() => route.warm.add(o), () => {})));
  // Keep one warm standby; a boot that fails is tried again later, so failover and rotation recover.
  function ensureSecondary() {
    if (closed || secondary || replacing) return;
    replacing = bootRoute()
      .then(async (r) => {
        await warmUp(r);
        if (closed) r.close();
        else secondary = r;
      })
      .catch(() => { if (!closed) standbyRetry = setTimeout(ensureSecondary, STANDBY_RETRY_MS); })
      .finally(() => { replacing = null; });
  }
  ensureSecondary();
  // Resolves when a standby is ready, or after ms.
  async function standbyReady(ms) {
    const until = performance.now() + ms;
    while (!secondary && !closed && performance.now() < until) await sleep(250);
    return secondary;
  }
  function promote() {
    const old = primary;
    primary = secondary;
    secondary = null;
    retire(old);
    ensureSecondary();
  }

  let rotation = null;
  const scheduleRotation = () => {
    if (rotateMs && !closed) rotation = setTimeout(rotate, rotateMs * (0.75 + 0.5 * random()));
  };
  function rotate() {
    if (secondary) {
      log({ event: "rotate" });
      promote();
    }
    scheduleRotation();
  }
  scheduleRotation();

  const latencies = [];
  // Hedge timers created in the same tick fire in one callback, so their copies join one batch.
  const hedgeGroups = new Map();
  function after(ms, fn) {
    let group = hedgeGroups.get(ms);
    if (!group) {
      const g = (group = new Set());
      hedgeGroups.set(ms, g);
      queueMicrotask(() => hedgeGroups.delete(ms));
      setTimeout(() => g.forEach((f) => f()), ms);
    }
    group.add(fn);
    return () => group.delete(fn);
  }

  // The primary's answer, or the standby's if the primary is still silent after the hedge delay.
  function hedged(route, origin, pending, attempt) {
    const backup = secondary;
    if (hedgeLambdaMs === null || backup === route || !backup?.warm.has(origin) || latencies.length < HEDGE_MIN_SAMPLES) return pending;
    const d = hedgeDelay(latencies, hedgeLambdaMs);
    if (d === Infinity) return pending;
    return new Promise((resolve, reject) => {
      let fired = false;
      const cancel = after(d, () => {
        fired = true;
        log({ event: "hedge", delayMs: d });
        attempt(backup).then(resolve, () => pending.then(resolve, reject));
      });
      pending.then((r) => { cancel(); resolve(r); }, (e) => { if (!fired) { cancel(); reject(e); } });
    });
  }

  // Concurrent sends of the same signed transaction share one request. A write that stalls is
  // resent on the standby: the same raw transaction has the same hash, so a second copy is harmless.
  const inflightWrites = new Map();

  async function request(url, body) {
    if (Array.isArray(body)) throw new TypeError("send JSON-RPC calls one at a time; batching is automatic");
    if (body.method !== "eth_sendRawTransaction") return withFailover(url, (route) => route.send(url, body));
    const key = body.params?.[0];
    if (!inflightWrites.has(key)) {
      inflightWrites.set(key, withFailover(url, (route) => route.send(url, body), { hedge: false }).finally(() => inflightWrites.delete(key)));
    }
    return inflightWrites.get(key);
  }

  async function withFailover(url, attempt, { hedge = true } = {}) {
    const origin = new URL(url).origin;
    let route = primary;
    if (overflow && primary.busy(url) && secondary?.warm.has(origin) && !secondary.busy(url)) {
      route = secondary;
      log({ event: "overflow" });
    }
    usedOrigins.add(origin);
    const warm = route.warm.has(origin);
    const start = performance.now();
    const pending = attempt(route);
    if (warm) pending.then(() => { latencies.push(performance.now() - start); if (latencies.length > HEDGE_WINDOW) latencies.shift(); }, () => {});
    try {
      const timeout = warm ? ATTEMPT_TIMEOUT_MS : FIRST_CONTACT_TIMEOUT_MS;
      const result = await withTimeout(hedge ? hedged(route, origin, pending, attempt) : pending, timeout, "attempt");
      route.warm.add(origin);
      return result;
    } catch (e) {
      if (route !== primary) return attempt(primary);
      // A fast error means the provider dropped the connection, not that the route stalled.
      if (e?.message !== "attempt timeout") return attempt(route);
      if (!secondary) {
        // No standby yet: take the stalled route's answer if it comes, or move once a standby is ready.
        ensureSecondary();
        const first = await Promise.race([
          pending.then((r) => ({ r }), (err) => ({ err })),
          standbyReady(BOOT_TIMEOUT_MS).then(() => null),
        ]);
        if (first) { if ("err" in first) throw first.err; return first.r; }
        if (route !== primary) return attempt(primary);
        if (!secondary) throw new Error("no route answered");
      }
      log({ event: "failover" });
      promote();
      return attempt(primary);
    }
  }

  // Learn, through the mixnet, when the specifier has moved past the pinned worker. Sent on the
  // primary directly, so the mainnet provider doesn't join the origins every standby warms.
  withTimeout(primary.send(specifierRpc, { jsonrpc: "2.0", id: 0, method: "eth_call", params: [{ to: NYM_SPECIFIER, data: SEL_WORKER_HASH }, "latest"] }), FIRST_CONTACT_TIMEOUT_MS, "specifier check")
    .then((r) => {
      if (typeof r?.result === "string" && r.result.toLowerCase() !== workerHash.toLowerCase()) log({ event: "specifier-changed", live: r.result });
    }, () => {});

  // Separate routes ("lanes") for large background fetches. A big reply holds its route's tunnel for
  // seconds, so on the wallet's route it would queue the wallet's calls behind it and trip the
  // attempt timeout into needless failovers. Each lane boots on first use; a stalled one is replaced.
  // Calls go round-robin over `bulkLanes` lanes, so two lanes carry about twice the data.
  const lanes = Array.from({ length: Math.max(1, bulkLanes) }, () => ({ route: null, booting: null, queues: new Map() }));
  let nextLane = 0;
  function laneRoute(lane) {
    if (lane.route) return Promise.resolve(lane.route);
    lane.booting ??= bootRoute()
      .then((r) => {
        if (closed) { r.close(); throw new Error("client closed"); }
        return (lane.route = r);
      })
      .finally(() => { lane.booting = null; });
    return lane.booting;
  }
  // Per lane and URL: one bulk call in flight, sent alone (a batch of large replies times out as a
  // whole), and only the newest waiting call kept; an older waiting call is superseded. Head-following
  // callers want the latest block, so piling up stale fetches only delays it.
  async function sendBulk(lane, url, q, body) {
    q.busy = true;
    let route;
    try {
      route = await laneRoute(lane);
      const start = performance.now();
      const reply = await withTimeout(postJson(route.worker, url, body, padBytes), BULK_TIMEOUT_MS, "bulk");
      log({ event: "bulk", lane: lanes.indexOf(lane), ms: Math.round(performance.now() - start), bytes: JSON.stringify(reply).length });
      return reply;
    } catch (e) {
      log({ event: "bulk-failed", lane: lanes.indexOf(lane), reason: String(e?.message ?? e).slice(0, 80) });
      if (e?.message === "bulk timeout" && route && lane.route === route) { lane.route = null; route.close(); }
      throw e;
    } finally {
      q.busy = false;
      const next = q.next;
      q.next = null;
      if (next) sendBulk(lane, url, q, next.body).then(next.resolve, next.reject);
    }
  }
  function bulk(url, body) {
    if (Array.isArray(body)) return Promise.reject(new TypeError("send JSON-RPC calls one at a time; batching is automatic"));
    const lane = lanes[nextLane];
    nextLane = (nextLane + 1) % lanes.length;
    let q = lane.queues.get(url);
    if (!q) lane.queues.set(url, (q = { busy: false, next: null }));
    if (!q.busy) return sendBulk(lane, url, q, body);
    q.next?.reject(new Error("bulk superseded"));
    return new Promise((resolve, reject) => { q.next = { body, resolve, reject }; });
  }

  return {
    request,
    // For large background reads that must not delay wallet calls: own route, no failover, no
    // batching, 60 s cap from when the call is sent, and a newer call supersedes an older waiting one.
    bulk,
    // Milliseconds each JSON-RPC call spent queued behind a request in flight on its route (the last 1,000).
    stats: () => ({ queueWaitsMs: [...queueWaits] }),
    fetch: (url, init) => withFailover(url, (route) => route.fetch(url, init)),
    close() {
      closed = true;
      clearTimeout(rotation);
      clearTimeout(standbyRetry);
      lanes.forEach((l) => l.route?.close());
      primary.close();
      secondary?.close();
      retiring.forEach((r) => r.close());
    },
  };
}
