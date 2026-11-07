// Offline behaviour test for client/atmos.js: a fake Nym directory, WebSocket and worker.
// Run with `npm test` in bench/.
import assert from "node:assert/strict";
import { createAtmosClient } from "../../client/atmos.js";

const PIN = "0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8";
const SPEC = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
const URL_A = "https://rpc.example/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Nym directory: 6 entry gateways and 6 exits, all in the top band.
globalThis.fetch = async (url) => {
  const ids = Array.from({ length: Math.max(6, net.exits) }, (_, i) => i + 1);
  const body = url.includes("entry-gateways") ? ids.map((i) => ({ node_id: i, performance: net.performance, ed25519_identity_pubkey: `gw${i}`, entry: { hostname: `gw${i}.example`, wss_port: 9001 } }))
    : url.includes("exit-gateways") ? ids.slice(0, net.exits).map((i) => ({ node_id: i, performance: net.performance }))
    : ids.map((i) => ({ node_id: i, description: { ip_packet_router: { address: `ipr${i}` } } }));
  return { json: async () => body };
};
// Gateways answer unless `net.gatewaysDown` is set; `net.exits` sets how many exits the directory lists.
const net = { gatewaysDown: false, exits: 6, performance: "1" };
globalThis.WebSocket = class { constructor() { setTimeout(() => (net.gatewaysDown ? this.onerror?.() : this.onopen?.()), 1); } close() {} };

// A worker answering JSON-RPC (single or batch). Per-instance controls: stall, delayMs, failNext.
const workers = [];
class FakeWorker {
  static readyDelayMs = 0;
  static stallNew = false;
  static caps = { "capped.example": 2 };
  // Methods whose replies take this long, like a block's access list through the mixnet.
  static slow = {};
  constructor(init) {
    this.init = init;
    this.posts = [];
    this.delayMs = 5;
    this.ready = sleep(FakeWorker.readyDelayMs);
    // A route can be up yet never answer: let its probe through, then stall what follows.
    if (FakeWorker.stallNew) this.ready.then(() => setTimeout(() => (this.stall = true), 50));
    workers.push(this);
  }
  async fetch(url, init = {}) {
    if (init.method === "HEAD") { (this.heads ??= []).push(url); return { ok: true }; }
    this.posts.push({ url, body: init.body });
    if (this.stall) return new Promise(() => {});
    await sleep(FakeWorker.slow[JSON.parse(init.body).method] ?? this.delayMs);
    if (this.closed) throw new Error("worker closed");
    if (this.failNext) { this.failNext--; throw new Error("connection closed"); }
    const req = JSON.parse(init.body);
    if (Array.isArray(req) && req.length > (FakeWorker.caps[new URL(url).host] ?? Infinity)) {
      return { json: async () => ({ jsonrpc: "2.0", id: null, error: { code: -32014, message: "too many RPC calls in batch request" } }) };
    }
    const answer = (r) => ({ jsonrpc: "2.0", id: r.id, result: r.method === "eth_chainId" ? "0x1" : `${r.method}:${JSON.stringify(r.params)}` });
    const reply = Array.isArray(req) ? req.map(answer) : answer(req);
    return { json: async () => reply };
  }
  close() { this.closed = true; }
}

const providerCalls = [];
const bootstrapProvider = { request: async (a) => { providerCalls.push(a); return "0x"; } };
const rpc = (id, method, params = []) => ({ jsonrpc: "2.0", id, method, params });

async function client(opts = {}) {
  workers.length = 0;
  Object.assign(net, { gatewaysDown: false, exits: 6, performance: "1" });
  FakeWorker.readyDelayMs = 0;
  const events = [];
  const c = await createAtmosClient({ bootstrapProvider, probeUrl: URL_A, Worker: FakeWorker, log: (e) => events.push(e), ...opts });
  for (let i = 0; i < 100 && workers.length < 2; i++) await sleep(5); // standby boots in the background
  await sleep(20);
  return { c, events };
}

const tests = {
  async "boot: probe, pinned specifier, egress allowlist, connect timeout"() {
    const { c } = await client();
    const w = workers[0];
    assert.equal(w.init.expectedHash, PIN);
    assert.deepEqual(w.init.network.policy.hosts, ["validator.nymtech.net", w.init.network.policy.hosts[1]]);
    assert.match(w.init.network.policy.hosts[1], /^gw\d\.example$/);
    assert.equal(w.init.config.connectTimeoutMs, 15000);
    assert.notEqual(workers[0].init.config.preferredIpr, workers[1].init.config.preferredIpr, "fresh exit per route");
    providerCalls.length = 0;
    const p = w.init.preExisting.rpcProvider;
    assert.equal(await p.request({ method: "eth_call", params: [{ to: SPEC, data: "0x3898587d" }, "latest"] }), PIN);
    assert.match(await p.request({ method: "eth_call", params: [{ to: SPEC, data: "0x1c67ff29" }, "latest"] }), /^0x0{62}20/);
    assert.equal(providerCalls.length, 0, "specifier reads never reach the provider");
    await p.request({ method: "eth_chainId", params: [] });
    assert.equal(providerCalls.length, 1, "other calls still do");
    c.close();
  },

  async "same-tick reads leave as one batch, ids restored"() {
    const { c } = await client();
    const w = workers[0];
    w.posts.length = 0;
    const replies = await Promise.all([1, 2, 3].map((i) => c.request(URL_A, rpc(100 + i, "eth_getBalance", [`0x${i}`]))));
    assert.equal(w.posts.length, 1);
    assert.equal(JSON.parse(w.posts[0].body).length, 3);
    assert.deepEqual(replies.map((r) => r.id), [101, 102, 103]);
    assert.equal(replies[1].result, 'eth_getBalance:["0x2"]');
    c.close();
  },

  async "batch cap per provider host (flashbots 5)"() {
    const { c } = await client();
    const w = workers[0];
    w.posts.length = 0;
    await Promise.all(Array.from({ length: 7 }, (_, i) => c.request("https://rpc.flashbots.net/", rpc(i, "eth_blockNumber"))));
    assert.deepEqual(w.posts.map((p) => JSON.parse(p.body).length), [5, 2]);
    c.close();
  },

  async "padBytes pads every body to a multiple, JSON unchanged"() {
    const { c } = await client({ padBytes: 2048 });
    const w = workers[0];
    w.posts.length = 0;
    await c.request(URL_A, rpc(1, "eth_blockNumber"));
    assert.equal(w.posts[0].body.length, 2048);
    assert.deepEqual(JSON.parse(w.posts[0].body), rpc(1, "eth_blockNumber"));
    c.close();
  },

  async "writes are deduplicated and never sent twice"() {
    const { c } = await client();
    const w = workers[0];
    w.posts.length = 0;
    const tx = rpc(1, "eth_sendRawTransaction", ["0xabc"]);
    const [a, b] = await Promise.all([c.request(URL_A, tx), c.request(URL_A, { ...tx, id: 2 })]);
    assert.equal(a, b);
    assert.equal(w.posts.length, 1);
    c.close();
  },

  async "a fast error retries on the same route, no failover"() {
    const { c, events } = await client();
    workers[0].failNext = 1;
    const r = await c.request(URL_A, rpc(1, "eth_blockNumber"));
    assert.equal(r.result, "eth_blockNumber:[]");
    assert.equal(events.filter((e) => e.event === "failover").length, 0);
    c.close();
  },

  async "a stalled route fails over to the warm standby"() {
    const { c, events } = await client();
    const [first, standby] = workers;
    first.stall = true;
    const r = await c.request(URL_A, rpc(1, "eth_blockNumber"));
    assert.equal(r.result, "eth_blockNumber:[]");
    assert.equal(events.filter((e) => e.event === "failover").length, 1);
    assert.ok(standby.posts.length > 0);
    c.close();
  },

  async "rotation swaps the primary for the standby"() {
    const { c, events } = await client({ rotateMs: 150 });
    await sleep(400);
    assert.ok(events.some((e) => e.event === "rotate"));
    const r = await c.request(URL_A, rpc(1, "eth_blockNumber"));
    assert.equal(r.result, "eth_blockNumber:[]");
    c.close();
  },

  async "overflow sends a read to the standby instead of queueing; stats record waits"() {
    const { c, events } = await client({ overflow: true });
    const [first, standby] = workers;
    first.delayMs = 200;
    const a = c.request(URL_A, rpc(1, "eth_blockNumber"));
    await sleep(20);
    standby.posts.length = 0;
    const b = c.request(URL_A, rpc(2, "eth_chainId"));
    await Promise.all([a, b]);
    assert.ok(events.some((e) => e.event === "overflow"));
    assert.equal(standby.posts.length, 1);
    assert.ok(Array.isArray(c.stats().queueWaitsMs) && c.stats().queueWaitsMs.length > 0);
    c.close();
  },

  async "without overflow the second read queues behind the first"() {
    const { c } = await client();
    workers[0].delayMs = 150;
    const a = c.request(URL_A, rpc(1, "eth_blockNumber"));
    await sleep(20);
    const b = c.request(URL_A, rpc(2, "eth_chainId"));
    await Promise.all([a, b]);
    assert.ok(Math.max(...c.stats().queueWaitsMs) >= 100, "the queued read waited");
    c.close();
  },
};

// Audit regressions (claude-docs/audit-atmos-client.md): each failed before its fix.
const audit = {
  async "C1: a standby that fails to boot is retried, so failover recovers"() {
    workers.length = 0;
    Object.assign(net, { gatewaysDown: false, exits: 6 });
    FakeWorker.readyDelayMs = 0;
    const events = [];
    const c = await createAtmosClient({ bootstrapProvider, probeUrl: URL_A, Worker: FakeWorker, log: (e) => events.push(e) });
    net.gatewaysDown = true; // the first standby boot finds no gateway
    await sleep(100);
    net.gatewaysDown = false;
    await sleep(7_000);
    workers[0].stall = true;
    const r = await withCap(c.request(URL_A, rpc(1, "eth_blockNumber")), 12_000);
    assert.equal(r.result, "eth_blockNumber:[]");
    c.close();
  },

  async "C2: rotation keeps working after every exit has been used once"() {
    // 6 exits; a retiring route keeps its exit for the 30 s grace, so reuse shows after that.
    const { c, events } = await client({ rotateMs: 2_000 });
    await sleep(45_000);
    assert.ok(events.filter((e) => e.event === "rotate").length > 8, `rotations: ${events.filter((e) => e.event === "rotate").length}`);
    c.close();
  },

  async "C3: a write stuck on a stalled route is resent on the standby, not held forever"() {
    const { c } = await client();
    workers[0].stall = true;
    const tx = rpc(1, "eth_sendRawTransaction", ["0xdef"]);
    const r = await withCap(c.request(URL_A, tx), 12_000);
    assert.equal(r.result, 'eth_sendRawTransaction:["0xdef"]');
    c.close();
  },

  async "C4: a read on a stalled route with no standby yet still gets an answer once one boots"() {
    workers.length = 0;
    Object.assign(net, { gatewaysDown: false, exits: 6 });
    const c = await createAtmosClient({ bootstrapProvider, probeUrl: URL_A, Worker: FakeWorker });
    net.gatewaysDown = true;
    await sleep(100);
    workers[0].stall = true;
    net.gatewaysDown = false;
    const r = await withCap(c.request(URL_A, rpc(1, "eth_blockNumber")), 20_000);
    assert.equal(r.result, "eth_blockNumber:[]");
    c.close();
  },

  async "C5: queue-wait stats stay bounded"() {
    const { c } = await client();
    for (let i = 0; i < 30; i++) await Promise.all(Array.from({ length: 100 }, (_, j) => c.request(URL_A, rpc(j, "eth_blockNumber"))));
    assert.ok(c.stats().queueWaitsMs.length <= 1000, `kept ${c.stats().queueWaitsMs.length}`);
    c.close();
  },

  async "C6: close() during a standby boot leaves no worker open"() {
    workers.length = 0;
    Object.assign(net, { gatewaysDown: false, exits: 6 });
    FakeWorker.readyDelayMs = 0;
    const c = await createAtmosClient({ bootstrapProvider, probeUrl: URL_A, Worker: FakeWorker });
    FakeWorker.readyDelayMs = 300; // the standby is still booting when the client closes
    c.close();
    await sleep(600);
    FakeWorker.readyDelayMs = 0;
    assert.deepEqual(workers.filter((w) => !w.closed).length, 0);
  },
};
Object.assign(audit, {
  async "H3: an unknown provider's batch cap is learned and the batch resent"() {
    const { c } = await client();
    const w = workers[0];
    w.posts.length = 0;
    const replies = await Promise.all(Array.from({ length: 5 }, (_, i) => c.request("https://capped.example/", rpc(i, "eth_blockNumber"))));
    assert.ok(replies.every((r) => r.result === "eth_blockNumber:[]"));
    assert.deepEqual(w.posts.map((p) => [JSON.parse(p.body)].flat().length), [5, 2, 2, 1]);
    c.close();
  },

  async "H5: a band below the 0.99 bar still boots from the best nodes"() {
    workers.length = 0;
    Object.assign(net, { gatewaysDown: false, exits: 6, performance: "0.9" });
    const c = await createAtmosClient({ bootstrapProvider, probeUrl: URL_A, Worker: FakeWorker });
    net.performance = "1";
    assert.equal((await c.request(URL_A, rpc(1, "eth_blockNumber"))).result, "eth_blockNumber:[]");
    c.close();
  },

  async "C9: array bodies are refused instead of corrupted"() {
    const { c } = await client();
    await assert.rejects(c.request(URL_A, [rpc(1, "eth_blockNumber")]), TypeError);
    c.close();
  },

  async "C12: the specifier check is not warmed on standbys"() {
    const { c } = await client();
    await sleep(50);
    const heads = workers.slice(1).flatMap((w) => w.heads ?? []);
    assert.ok(!heads.some((u) => u.includes("publicnode")), heads.join(","));
    c.close();
  },
});
Object.assign(audit, {
  async "BAL: a slow fetch on the wallet lane trips the attempt timeout into a failover (the jam)"() {
    const { c, events } = await client();
    FakeWorker.slow = { eth_getBlockAccessList: 10_000 };
    await c.request(URL_A, rpc(1, "eth_getBlockAccessList", ["0x1"]));
    FakeWorker.slow = {};
    assert.ok(events.some((e) => e.event === "failover"), "the old path fails over on a large reply");
    c.close();
  },

  async "BAL: bulk() keeps a slow fetch off the wallet lane: no failover, wallet calls stay fast"() {
    const { c, events } = await client();
    FakeWorker.slow = { eth_getBlockAccessList: 10_000 };
    const big = c.bulk(URL_A, rpc(1, "eth_getBlockAccessList", ["0x1"]));
    await sleep(3_000); // the bulk lane has booted and its fetch is in flight
    const t = performance.now();
    const r = await c.request(URL_A, rpc(2, "eth_getBalance", ["0x2"]));
    const walletMs = performance.now() - t;
    assert.equal(r.result, 'eth_getBalance:["0x2"]');
    assert.ok(walletMs < 200, `wallet call took ${Math.round(walletMs)} ms`);
    assert.equal((await big).result, 'eth_getBlockAccessList:["0x1"]');
    FakeWorker.slow = {};
    assert.equal(events.filter((e) => e.event === "failover").length, 0);
    c.close();
  },
});
Object.assign(audit, {
  async "BAL: bulk calls leave one at a time, never batched; a newer waiting call supersedes an older one"() {
    const { c } = await client();
    FakeWorker.slow = { eth_getBlockAccessList: 500 };
    const calls = [1, 2, 3].map((n) => c.bulk(URL_A, rpc(n, "eth_getBlockAccessList", [`0x${n}`])).then((r) => r.result, (e) => e.message));
    const results = await Promise.all(calls);
    FakeWorker.slow = {};
    assert.deepEqual(results, ['eth_getBlockAccessList:["0x1"]', "bulk superseded", 'eth_getBlockAccessList:["0x3"]']);
    const lane = workers.find((w) => w.posts.some((p) => p.body.includes("eth_getBlockAccessList")));
    assert.ok(lane.posts.filter((p) => p.body.includes("eth_getBlockAccessList")).every((p) => !Array.isArray(JSON.parse(p.body))));
    c.close();
  },
});
Object.assign(audit, {
  async "BAL: bulkLanes 2 carries two fetches at once on two routes"() {
    const { c, events } = await client({ bulkLanes: 2 });
    FakeWorker.slow = { eth_getBlockAccessList: 800 };
    await Promise.all([c.bulk(URL_A, rpc(0, "eth_blockNumber"))]); // lane 1 boots
    await Promise.all([c.bulk(URL_A, rpc(0, "eth_blockNumber"))]); // lane 2 boots
    const t = performance.now();
    const results = await Promise.all([1, 2].map((n) => c.bulk(URL_A, rpc(n, "eth_getBlockAccessList", [`0x${n}`])).then((r) => r.result)));
    const ms = performance.now() - t;
    FakeWorker.slow = {};
    assert.deepEqual(results, ['eth_getBlockAccessList:["0x1"]', 'eth_getBlockAccessList:["0x2"]']);
    assert.ok(ms < 1_400, `two fetches took ${Math.round(ms)} ms, so they ran in parallel`);
    const carriers = workers.filter((w) => w.posts.some((p) => p.body.includes("eth_getBlockAccessList")));
    assert.equal(carriers.length, 2);
    const logged = events.filter((e) => e.event === "bulk" && e.bytes > 0);
    assert.deepEqual([...new Set(logged.map((e) => e.lane))].sort(), [0, 1], "each bulk reply is logged with its lane");
    c.close();
  },
});
Object.assign(audit, {
  async "BAL: bulkTunnel options reach the bulk lanes only"() {
    const { c } = await client({ bulkTunnel: { openReplySurbs: 100, dataReplySurbs: 4 } });
    await c.bulk(URL_A, rpc(1, "eth_blockNumber"));
    const lane = workers.at(-1);
    assert.equal(lane.init.config.openReplySurbs, 100);
    assert.equal(lane.init.config.dataReplySurbs, 4);
    assert.ok(workers.slice(0, -1).every((w) => w.init.config.openReplySurbs === undefined), "wallet routes keep the defaults");
    c.close();
  },
});
Object.assign(audit, {
  async "BAL: bulkReplace swaps a lane that is too slow for the block rate"() {
    const { c, events } = await client({ bulkReplace: true });
    FakeWorker.slow = { eth_getBlockAccessList: 0 };
    await c.bulk(URL_A, rpc(0, "eth_blockNumber")); // the lane boots
    const lane = workers.at(-1);
    lane.delayMs = 5;
    // Pretend each list took 20 s: the client measures real time, so stub the clock for these calls.
    const realNow = performance.now.bind(performance);
    let skew = 0;
    performance.now = () => realNow() + skew;
    const origFetch = lane.fetch.bind(lane);
    lane.fetch = async (...a) => { const r = await origFetch(...a); skew += 20_000; return r; };
    for (let i = 1; i <= 5; i++) await c.bulk(URL_A, rpc(i, "eth_getBlockAccessList", [`0x${i}`]));
    performance.now = realNow;
    FakeWorker.slow = {};
    await sleep(100);
    assert.ok(events.some((e) => e.event === "bulk-lane-slow"));
    assert.ok(events.some((e) => e.event === "bulk-lane-replaced"));
    const r = await c.bulk(URL_A, rpc(9, "eth_getBlockAccessList", ["0x9"]));
    assert.equal(r.result, 'eth_getBlockAccessList:["0x9"]');
    assert.notEqual(workers.at(-1), lane, "a new route carries the lane");
    c.close();
  },

  async "BAL: without bulkReplace a slow lane is kept"() {
    const { c, events } = await client();
    await c.bulk(URL_A, rpc(0, "eth_blockNumber"));
    const realNow = performance.now.bind(performance);
    let skew = 0;
    performance.now = () => realNow() + skew;
    const lane = workers.at(-1);
    const origFetch = lane.fetch.bind(lane);
    lane.fetch = async (...a) => { const r = await origFetch(...a); skew += 20_000; return r; };
    for (let i = 1; i <= 5; i++) await c.bulk(URL_A, rpc(i, "eth_getBlockAccessList", [`0x${i}`]));
    performance.now = realNow;
    assert.ok(!events.some((e) => e.event === "bulk-lane-replaced"));
    c.close();
  },
});
Object.assign(audit, {
  async "R1: a primary whose worker died (fast errors) fails over to the standby"() {
    const { c, events } = await client();
    workers[0].closed = true; // every call on it now fails at once with "worker closed"
    const r = await withCap(c.request(URL_A, rpc(1, "eth_blockNumber")), 2_000);
    assert.equal(r.result, "eth_blockNumber:[]");
    assert.ok(events.some((e) => e.event === "failover"));
    c.close();
  },

  async "R2: a bulk lane that keeps erroring is replaced"() {
    const { c } = await client();
    await c.bulk(URL_A, rpc(0, "eth_blockNumber"));
    const lane = workers.at(-1);
    lane.failNext = 2;
    await assert.rejects(c.bulk(URL_A, rpc(1, "eth_getBlockAccessList", ["0x1"])));
    await assert.rejects(c.bulk(URL_A, rpc(2, "eth_getBlockAccessList", ["0x2"])));
    const r = await c.bulk(URL_A, rpc(3, "eth_getBlockAccessList", ["0x3"]));
    assert.equal(r.result, 'eth_getBlockAccessList:["0x3"]');
    assert.notEqual(workers.at(-1), lane, "a new route carries the lane");
    c.close();
  },
});
Object.assign(audit, {
  async "C14: every call settles even when every route stalls"() {
    const { c } = await client();
    for (const w of workers) w.stall = true; // the primary and the standby both stop answering
    FakeWorker.stallNew = true; // and so does any route booted from now on
    const outcome = await withCap(c.request(URL_A, rpc(1, "eth_blockNumber")).then(() => "answered", (e) => `rejected: ${e.message}`), 90_000);
    FakeWorker.stallNew = false;
    assert.match(outcome, /rejected/);
    c.close();
  },
});
const withCap = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms`); })]);
if (!process.argv.includes("--no-audit")) Object.assign(tests, audit);

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.log("FAIL", name, "\n     ", e.message); }
}
console.log(failed ? `${failed} failed` : `all ${Object.keys(tests).length} passed`);
process.exit(failed ? 1 : 0);
