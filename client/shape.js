// Constant-rate schedule over a JSON-RPC transport. Every lane (URL and class)
// sends exactly BATCH calls each interval, at a random phase, filling empty places
// with dummies shaped like recent real calls, so neither the count nor the timing
// of a slot shows demand. Writes are not delayed.
const LANES = { read: 2_000, proof: 4_000 };
const BATCH = 4;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const randomInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const randomAddress = () =>
  "0x" + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");

// `open`: URLs whose lanes start at once. A lane that first appears when the user
// becomes active is itself a signal, so every lane the caller will use should be
// open from the start; the cost is constant traffic on each.
// `intervals`: slot length per lane kind, to trade latency against constant load.
// `seed`: call shapes the dummies copy before any real call has been seen, so a
// lane's dummies look the same whether the user is idle or active.
export function createShaper({ request, open = [], intervals = LANES, seed = [] }) {
  const lanes = new Map();

  function dummy(lane) {
    const seen = lane.recent[randomInt(lane.recent.length || 1)];
    const base = seen ?? (lane.kind === "proof"
      ? { method: "eth_getProof", params: [null, [], "latest"] }
      : { method: "eth_getBalance", params: [null, "latest"] });
    const params = base.params.map((p) => (p === null || (typeof p === "string" && ADDRESS.test(p)) ? randomAddress() : p));
    return { jsonrpc: "2.0", id: randomInt(1e6), method: base.method, params };
  }

  function tick(lane) {
    const real = lane.queue.splice(0, BATCH);
    const calls = real.map((r) => r.body);
    while (calls.length < BATCH) calls.push(dummy(lane));
    // Real and dummy calls leave in the same tick, in random order, so the transport sends one batch.
    const order = calls.map((c) => [randomInt(1e9), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    const replies = new Map(order.map((c) => [c, request(lane.url, c)]));
    for (const p of replies.values()) p.catch(() => {});
    for (const r of real) replies.get(r.body).then(r.resolve, r.reject);
  }

  function laneFor(url, kind) {
    const key = `${kind} ${url}`;
    let lane = lanes.get(key);
    if (!lane) {
      lane = { url, kind, queue: [], recent: seed.filter((c) => (c.method === "eth_getProof") === (kind === "proof")) };
      const interval = intervals[kind];
      lane.timer = setTimeout(() => {
        tick(lane);
        lane.timer = setInterval(() => tick(lane), interval);
      }, randomInt(interval));
      lanes.set(key, lane);
    }
    return lane;
  }

  for (const url of open) for (const kind of Object.keys(LANES)) laneFor(url, kind);

  return {
    request(url, body) {
      if (body.method === "eth_sendRawTransaction") return request(url, body);
      const lane = laneFor(url, body.method === "eth_getProof" ? "proof" : "read");
      // With a seed, dummies keep the seed's shapes; learning from real calls would
      // shift their sizes exactly when the user becomes active.
      if (!seed.length) lane.recent = [...lane.recent.slice(-7), { method: body.method, params: body.params ?? [] }];
      return new Promise((resolve, reject) => lane.queue.push({ body, resolve, reject }));
    },
    close() {
      for (const lane of lanes.values()) { clearTimeout(lane.timer); clearInterval(lane.timer); }
    },
  };
}
