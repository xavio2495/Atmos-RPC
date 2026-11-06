import { AnonRpcWorker } from "@anon-rpc/browser-harness";

const NYM_SPECIFIER = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
const NYM_API = "https://validator.nymtech.net/api/v1";
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
const MAX_BATCH = { "eth.drpc.org": 3, "rpc.flashbots.net": 5 };
// A replaced route stays open this long so requests already in flight on it can finish.
const RETIRE_GRACE_MS = 30_000;
const DEFAULT_MAX_BATCH = 10;
// Hedge delays come from this public set, so the gap between two copies of a call reveals little.
const HEDGE_DELAYS_MS = [250, 500, 750, 1000, 1500, 2000, 3000];
const HEDGE_WINDOW = 50;
const HEDGE_MIN_SAMPLES = 20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error(`${what} timeout`); })]);
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

async function nymList(path) {
  const j = await (await fetch(NYM_API + path)).json();
  return Array.isArray(j) ? j : (j.nodes?.data ?? j.data);
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

// Entry gateways and IPR exits from the public directory, filtered to the
// top performance band. Choosing uniformly inside the band uses no client data.
async function loadBand() {
  const [entries, exits, described] = await Promise.all([
    nymList("/unstable/nym-nodes/skimmed/entry-gateways/all"),
    nymList("/unstable/nym-nodes/skimmed/exit-gateways/all"),
    nymList("/nym-nodes/described"),
  ]);
  const ipr = new Map(described.map((d) => [d.node_id, d.description?.ip_packet_router?.address]));
  return {
    entries: entries.filter((g) => Number(g.performance) >= 0.99 && g.entry?.wss_port && g.entry?.hostname),
    exits: exits.filter((x) => Number(x.performance) >= 0.99 && ipr.get(x.node_id)).map((x) => ipr.get(x.node_id)),
  };
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
  constructor(worker, padBytes = 0, onWait = () => {}) {
    this.worker = worker;
    this.padBytes = padBytes;
    this.onWait = onWait;
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
    const max = MAX_BATCH[new URL(url).host] ?? DEFAULT_MAX_BATCH;
    const items = q.pending.splice(0, max);
    const now = performance.now();
    items.forEach((it) => this.onWait(now - it.at));
    try {
      if (items.length === 1) {
        items[0].resolve(await postJson(this.worker, url, items[0].body, this.padBytes));
      } else {
        const ids = items.map((_, i) => i + 1);
        const reply = await postJson(this.worker, url, items.map((it, i) => ({ ...it.body, id: ids[i] })), this.padBytes);
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

  close() { this.worker.close(); }
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

// hedgeLambdaMs: when set, a slow read is also sent on the warm standby (a second exit sees it);
//   larger values hedge less. rotateMs: when set, the primary route is replaced about this often,
//   so no route stays long enough to become a timing fingerprint. tunnel: extra options for the
//   worker's mix tunnel (e.g. connectTimeoutMs); options the exit can observe make the client stand out.
//   padBytes: pad every JSON-RPC request body to a multiple of this many bytes.
//   workerHash, workerResolvers: the worker bundle to run and where to fetch it (default: the
//   pinned Nym worker). With a custom hash and no resolvers, the resolvers are read from the specifier.
//   overflow: a read that would queue behind a request in flight goes to the warm standby instead
//   (a second exit sees it).
export async function createAtmosClient({ overflow = false, bootstrapProvider, probeUrl, log = () => {}, Worker = AnonRpcWorker, hedgeLambdaMs = null, rotateMs = null, tunnel = {}, padBytes = 0,
  workerHash = NYM_WORKER_HASH, workerResolvers = workerHash === NYM_WORKER_HASH ? NYM_WORKER_RESOLVERS : null }) {
  const band = await loadBand();
  const queueWaits = [];
  const rpcProvider = pinSpecifier(bootstrapProvider, NYM_SPECIFIER, workerHash, workerResolvers);
  const usedExits = new Set();

  async function bootRoute() {
    for (let attempt = 0; attempt < 4; attempt++) {
      let entry = null;
      for (const g of shuffle(band.entries).slice(0, 6)) {
        if (await gatewayAnswers(g)) { entry = g; break; }
      }
      const exit = pick(band.exits.filter((x) => !usedExits.has(x)));
      if (!entry || !exit) continue;
      usedExits.add(exit);
      const worker = new Worker({
        address: NYM_SPECIFIER,
        // A pinned exit that hasn't answered the handshake in 15 s is dropped (the tunnel's default
        // is 60 s); a healthy handshake takes 1–3 s. Client-side only, so nothing the exit can see.
        config: { connectTimeoutMs: 15_000, ...tunnel, preferredGateway: entry.ed25519_identity_pubkey, preferredIpr: exit },
        preExisting: { rpcProvider },
        expectedHash: workerHash,
        // On harnesses that bridge the network (the Atmos Node harness), the worker may reach only
        // the Nym directory and its own entry gateway; everything else goes through the mixnet.
        network: { policy: { hosts: [new URL(NYM_API).hostname, entry.entry.hostname] } },
      });
      try {
        await withTimeout(worker.ready, BOOT_TIMEOUT_MS, "boot");
        const route = new Route(worker, padBytes, (ms) => queueWaits.push(Math.round(ms)));
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
        if (reason !== "boot timeout") { worker.close(); await sleep(2_000 * 2 ** attempt); continue; }
      }
      worker.close();
    }
    throw new Error("no working route");
  }

  let primary = await bootRoute();
  let secondary = null;
  let replacing = null;
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
  const ensureSecondary = () => {
    if (secondary || replacing) return;
    replacing = bootRoute()
      .then(async (r) => { await warmUp(r); secondary = r; })
      .catch(() => {})
      .finally(() => { replacing = null; });
  };
  ensureSecondary();

  let rotation = null;
  const scheduleRotation = () => {
    if (rotateMs) rotation = setTimeout(rotate, rotateMs * (0.75 + 0.5 * random()));
  };
  function rotate() {
    if (secondary) {
      log({ event: "rotate" });
      const old = primary;
      primary = secondary;
      secondary = null;
      retire(old);
      ensureSecondary();
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

  const inflightWrites = new Map();

  async function request(url, body) {
    if (body.method === "eth_sendRawTransaction") {
      usedOrigins.add(new URL(url).origin);
      const key = body.params?.[0];
      if (!inflightWrites.has(key)) {
        inflightWrites.set(key, primary.send(url, body).finally(() => inflightWrites.delete(key)));
      }
      return inflightWrites.get(key);
    }
    return withFailover(url, (route) => route.send(url, body));
  }

  async function withFailover(url, attempt) {
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
      const result = await withTimeout(hedged(route, origin, pending, attempt), timeout, "attempt");
      route.warm.add(origin);
      return result;
    } catch (e) {
      if (route !== primary) return attempt(primary);
      // A fast error means the provider dropped the connection, not that the route stalled.
      if (e?.message !== "attempt timeout") return attempt(route);
      // No standby to switch to: a slow route is still better than an error.
      if (!secondary) return pending;
      log({ event: "failover" });
      const failed = primary;
      primary = secondary;
      secondary = null;
      retire(failed);
      ensureSecondary();
      return attempt(primary);
    }
  }

  // Learn, through the mixnet, when the specifier has moved past the pinned worker.
  request(SPECIFIER_RPC, { jsonrpc: "2.0", id: 0, method: "eth_call", params: [{ to: NYM_SPECIFIER, data: SEL_WORKER_HASH }, "latest"] })
    .then((r) => {
      if (typeof r?.result === "string" && r.result.toLowerCase() !== workerHash.toLowerCase()) log({ event: "specifier-changed", live: r.result });
    }, () => {});

  return {
    request,
    // Milliseconds each JSON-RPC call spent queued behind a request in flight on its route.
    stats: () => ({ queueWaitsMs: [...queueWaits] }),
    fetch: (url, init) => withFailover(url, (route) => route.fetch(url, init)),
    close() {
      clearTimeout(rotation);
      primary.close();
      secondary?.close();
      retiring.forEach((r) => r.close());
    },
  };
}
