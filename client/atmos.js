import { AnonRpcWorker } from "@anon-rpc/browser-harness";

const NYM_SPECIFIER = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
const NYM_API = "https://validator.nymtech.net/api/v1";
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) =>
  Promise.race([p, sleep(ms).then(() => { throw new Error(`${what} timeout`); })]);
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

async function postJson(worker, url, body) {
  const r = await worker.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// One Nym worker plus a per-origin queue: at most one request in flight per
// origin, with everything that queued meanwhile sent as one JSON-RPC batch.
class Route {
  constructor(worker) {
    this.worker = worker;
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
      q.pending.push({ body, resolve, reject });
      // Let calls issued in the same tick join one batch.
      queueMicrotask(() => this.#drain(url, q));
    });
  }

  async #drain(url, q) {
    if (q.busy || q.pending.length === 0) return;
    q.busy = true;
    const max = MAX_BATCH[new URL(url).host] ?? DEFAULT_MAX_BATCH;
    const items = q.pending.splice(0, max);
    try {
      if (items.length === 1) {
        items[0].resolve(await postJson(this.worker, url, items[0].body));
      } else {
        const ids = items.map((_, i) => i + 1);
        const reply = await postJson(this.worker, url, items.map((it, i) => ({ ...it.body, id: ids[i] })));
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

  close() { this.worker.close(); }
}

export async function createAtmosClient({ bootstrapProvider, probeUrl, log = () => {}, Worker = AnonRpcWorker }) {
  const band = await loadBand();
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
        config: { preferredGateway: entry.ed25519_identity_pubkey, preferredIpr: exit },
        preExisting: { rpcProvider: bootstrapProvider },
      });
      try {
        await withTimeout(worker.ready, BOOT_TIMEOUT_MS, "boot");
        const route = new Route(worker);
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
        log({ event: "route-rejected", attempt, reason: String(e?.message ?? e) });
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
  const ensureSecondary = () => {
    if (secondary || replacing) return;
    replacing = bootRoute()
      .then((r) => { secondary = r; })
      .catch(() => {})
      .finally(() => { replacing = null; });
  };
  ensureSecondary();

  const inflightWrites = new Map();

  async function request(url, body) {
    if (body.method === "eth_sendRawTransaction") {
      const key = body.params?.[0];
      if (!inflightWrites.has(key)) {
        inflightWrites.set(key, primary.send(url, body).finally(() => inflightWrites.delete(key)));
      }
      return inflightWrites.get(key);
    }
    return withFailover(url, (route) => route.send(url, body));
  }

  async function withFailover(url, attempt) {
    const route = primary;
    const origin = new URL(url).origin;
    const pending = attempt(route);
    try {
      const timeout = route.warm.has(origin) ? ATTEMPT_TIMEOUT_MS : FIRST_CONTACT_TIMEOUT_MS;
      const result = await withTimeout(pending, timeout, "attempt");
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

  return {
    request,
    fetch: (url, init) => withFailover(url, (route) => route.fetch(url, init)),
    close() {
      primary.close();
      secondary?.close();
      retiring.forEach((r) => r.close());
    },
  };
}
