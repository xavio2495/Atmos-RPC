import { createAtmosClient, NYM_SPECIFIER, NYM_WORKER_LIMITS } from "../client/atmos.js";
import { createVerifiedReader, SEPOLIA } from "../client/verify.js";
import { createExecutor } from "../client/evm.js";
import { createReceiptChecker } from "../client/receipts.js";
import { createShaper } from "../client/shape.js";

const BOOTSTRAP_RPC = "https://ethereum-rpc.publicnode.com";
// Two independent Sepolia beacon APIs; the first also serves the light client.
const BEACONS = ["https://lodestar-sepolia.chainsafe.io", "https://ethereum-sepolia-beacon-api.publicnode.com"];
// Serves EIP-7928 block access lists (tenderly does not).
const ACCESS_LISTS = ["https://ethereum-sepolia-rpc.publicnode.com"];
// tenderly serves proofs a few blocks behind head; publicnode only at head.
const PROVIDERS = ["https://sepolia.gateway.tenderly.co", "https://ethereum-sepolia-rpc.publicnode.com"];
const LOCAL = {
  eth_chainId: "0x" + SEPOLIA.chainId.toString(16),
  net_version: String(SEPOLIA.chainId),
  web3_clientVersion: "atmos/0.1",
};

// The worker bootstraps from mainnet: its hash and download locations are read
// from the mainnet specifier. The host answers both from pinned values instead,
// so a boot sends nothing to an RPC provider from the host's own address. The
// bundle still has to match the pinned hash, so a stale download list can only
// make a boot fail, never run a different worker.
const NYM_WORKER_HASH = "0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8";
const NYM_RESOLVERS = [
  "https://cdn.jsdelivr.net/npm/@nymproject/anon-rpc-worker@0.1.0/dist/nym-anon-rpc-worker.js",
  "https://unpkg.com/@nymproject/anon-rpc-worker@0.1.0/dist/nym-anon-rpc-worker.js",
  "https://raw.githubusercontent.com/nymtech/anon-rpc-worker/keccak/f1/3a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8",
];
const SEL_WORKER_HASH = "0x3898587d";
const SEL_WORKER_RESOLVERS = "0x1c67ff29";

// ABI encoding of string[], as the specifier's workerResolvers() returns it.
function abiStringArray(list) {
  const word = (n) => BigInt(n).toString(16).padStart(64, "0");
  const hexOf = (u) => Array.from(new TextEncoder().encode(u), (b) => b.toString(16).padStart(2, "0")).join("");
  const parts = list.map((u) => { const h = hexOf(u); return word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, "0"); });
  let offset = 32 * list.length;
  const heads = parts.map((p) => { const o = offset; offset += p.length / 2; return word(o); });
  return "0x" + word(32) + word(list.length) + heads.join("") + parts.join("");
}

function makeBootstrapProvider(log) {
  return {
    request: async ({ method, params }) => {
      const call = method === "eth_call" ? params?.[0] : null;
      if (call && String(call.to).toLowerCase() === NYM_SPECIFIER.toLowerCase()) {
        if (call.data === SEL_WORKER_HASH) return NYM_WORKER_HASH;
        if (call.data === SEL_WORKER_RESOLVERS) return abiStringArray(NYM_RESOLVERS);
      }
      // Anything else goes out directly, and is logged so a boot test can see it.
      log({ event: "bootstrap-network", method });
      const r = await fetch(BOOTSTRAP_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
      });
      return (await r.json()).result;
    },
  };
}

const latest = (tag) => tag === undefined || tag === "latest";
const replyTo = (body, result) => ({ jsonrpc: "2.0", id: body.id, result });

const SHAPED_INTERVALS = { read: 4_000, proof: 8_000 };
const ANY = "0x0000000000000000000000000000000000000000";
export { NYM_WORKER_LIMITS };
const BLOCK_METHODS = new Set(["eth_getBlockByNumber", "eth_getBlockByHash"]);
const SHAPED_SEED = [
  { method: "eth_getBalance", params: [ANY, "latest"] },
  { method: "eth_getTransactionCount", params: [ANY, "latest"] },
  { method: "eth_call", params: [{ to: ANY, data: "0x70a08231" + "0".repeat(64) }, "latest"] },
  { method: "eth_getBlockByHash", params: ["0x" + "0".repeat(64), false] },
  { method: "eth_getProof", params: [ANY, [], "latest"] },
];

// The light client's trust anchor when none is given: the finalized block root both
// beacon APIs report, read through the mixnet like everything else.
async function agreedCheckpoint(get) {
  for (let i = 0; i < 3; i++) {
    const roots = await Promise.all(BEACONS.map((b) => get(b + "/eth/v1/beacon/headers/finalized").then((r) => r.json()).then((j) => j.data.root)));
    if (roots[0] === roots[1]) return roots[0];
    await new Promise((r) => setTimeout(r, 12_000));
  }
  throw new Error("beacon APIs disagree on the finalized root");
}

// Atmos's RPC logic for Sepolia, the same under either runtime: in a browser with the
// browser harness, or in Node with the Node harness (`Worker`).
// `checkpoint`: a trusted beacon block root; by default the finalized root two beacon
// APIs agree on (trust on first use).
// `bal`: keep proven accounts current from verified EIP-7928 block access lists, so a
// repeat read names nothing to a provider. Costs a list fetch (3–9 s, 70–160 KB) per block.
// `shape`: every call leaves in fixed-size batches on a fixed clock (constant-rate
// schedule), so call timing and count stop showing activity. Costs latency.
// `trace`: called with every request as it leaves for the network (after any
// shaping), for measuring what an exit or provider can observe.
// `prefetch`: keep the wallet's recent verifiable reads re-proven at every new
// verified block, and answer a repeat from that block's result. Never answers
// with anything older than the current verified head. Off by default.
export function startAtmos({ checkpoint, Worker, shape = false, prefetch = false, bal = false, trace, log = (e) => console.log(JSON.stringify(e)) }) {
  // "advisory": proven in part. An estimate proven not to revert with the provider's
  // gas figure, or a block whose header is proven but whose transaction list is not.
  const counts = { verified: 0, advisory: 0, plain: 0, local: 0, failed: 0, prefetched: 0 };
  let reader, client, executor, receipts, transport, shaper, prefetcher, closed = false;

  const ready = (async () => {
    // Shaped mode also pads every request body to a fixed size (in 2 KB steps),
    // so batch sizes stop showing what is inside them.
    // Routes rotate about every 10 minutes, so no single route's timing lasts
    // longer than that (measured cost at a 2-minute period: about +90 ms p50).
    client = await createAtmosClient({
      bootstrapProvider: makeBootstrapProvider(log),
      probeUrl: PROVIDERS[0],
      log,
      rotateMs: 10 * 60_000,
      ...(Worker ? { Worker } : {}),
      ...(shape ? { padBytes: 2048 } : {}),
    });
    // With tracing on, each request is recorded as it leaves for the network.
    const traced = (send, describe) => (trace ? (url, x) => (trace({ t: Date.now(), host: new URL(url).host, ...describe(x) }), send(url, x)) : send);
    const wire = traced(client.request, (body) => ({ calls: Array.isArray(body) ? body.length : 1, bytes: JSON.stringify(body).length }));
    const fetchWire = traced(client.fetch, () => ({ calls: 1, bytes: 0, get: true }));
    // Shaped: every provider's lanes open at boot, on a slower clock than the
    // default (constant load is about 3 calls a second in total), and dummies
    // start from a fixed mix of wallet-like calls.
    shaper = shape ? createShaper({ request: wire, open: PROVIDERS, intervals: SHAPED_INTERVALS, seed: SHAPED_SEED }) : null;
    transport = shaper ? shaper.request : wire;
    checkpoint ??= await agreedCheckpoint(fetchWire);
    log({ event: "checkpoint", root: checkpoint });
    reader = await createVerifiedReader({
      request: transport,
      beaconGet: (path) => fetchWire(BEACONS[0] + path).then((r) => r.json()),
      checkpoint,
      providers: PROVIDERS,
      chain: SEPOLIA,
      accessLists: bal ? ACCESS_LISTS : null,
      // Access lists are large, public and the same for everyone: they go on the client's
      // bulk lane (its own route), unshaped, so they never hold up the wallet's calls.
      listRequest: traced(client.bulk, (body) => ({ calls: 1, bytes: JSON.stringify(body).length, bulk: true })),
      log,
    });
    if (closed) close();
    executor = createExecutor({ reader, chain: SEPOLIA });
    receipts = createReceiptChecker({ reader });
  })();

  // eth_call and eth_estimateGas run locally on proven state; null means "not handled here".
  async function execute(body) {
    const [tx, tag] = body.params ?? [];
    if (!tx || !latest(tag)) return null;
    if (body.method === "eth_call") {
      // A revert is a verified answer too; any other failure is not.
      const outcome = await executor.call(tx).then(
        (result) => ({ result }),
        (e) => { if (e.code !== 3) throw e; return { error: { code: 3, message: e.message, data: e.data } }; },
      );
      counts.verified++;
      return { jsonrpc: "2.0", id: body.id, ...outcome };
    }
    const estimate = await reader.hint({ jsonrpc: "2.0", id: body.id, method: "eth_estimateGas", params: [tx] });
    const result = await executor.estimateGas(tx, estimate);
    counts.advisory++;
    return replyTo(body, result);
  }

  // One JSON-RPC call in, one response out. Calls the verifier can't check go to
  // the first provider unverified and are counted, so the host's share is visible.
  async function answer(body) {
    await ready;
    if (body.method in LOCAL) {
      counts.local++;
      return replyTo(body, LOCAL[body.method]);
    }
    if (body.method === "eth_getTransactionReceipt") {
      const result = await receipts.receipt(body.params[0]);
      counts[result ? "verified" : "advisory"]++;
      return replyTo(body, result);
    }
    if (body.method === "eth_call" || body.method === "eth_estimateGas") {
      const r = await execute(body);
      if (r) return r;
    }
    try {
      const r = await reader.request(PROVIDERS[0], body);
      // A block's header fields are proven; its transaction list is the provider's.
      counts[r.error ? "failed" : BLOCK_METHODS.has(body.method) ? "advisory" : "verified"]++;
      return r;
    } catch (e) {
      if (!String(e?.message).startsWith("not verifiable")) throw e;
      counts.plain++;
      return transport(PROVIDERS[0], body);
    }
  }

  const PREFETCHABLE = new Set(["eth_getBalance", "eth_getTransactionCount", "eth_getCode", "eth_getStorageAt", "eth_call"]);
  const WORKING_SET_MAX = 32;
  const WORKING_SET_KEEP_MS = 5 * 60_000;
  const workingSet = new Map();
  const atLatest = (body) => latest((body.params ?? [])[body.method === "eth_getStorageAt" ? 2 : 1]);

  async function handle(body) {
    if (!prefetch || !PREFETCHABLE.has(body.method) || !atLatest(body)) return answer(body);
    await ready;
    const key = JSON.stringify([body.method, body.params]);
    const number = (await reader.head()).number;
    const entry = workingSet.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
      if (entry.block === number && entry.reply) {
        counts.prefetched++;
        return { ...entry.reply, id: body.id };
      }
    }
    const reply = await answer(body);
    if (workingSet.has(key) || workingSet.size < WORKING_SET_MAX) {
      workingSet.set(key, { body, lastUsed: Date.now(), block: number, reply: reply.error ? null : reply });
    }
    return reply;
  }

  // On each new verified head, re-prove every read the wallet used recently.
  if (prefetch) {
    let seen = -1;
    ready.then(() => (prefetcher = setInterval(async () => {
      const number = (await reader.head()).number;
      if (number === seen) return;
      seen = number;
      for (const [key, e] of workingSet) {
        if (Date.now() - e.lastUsed > WORKING_SET_KEEP_MS) { workingSet.delete(key); continue; }
        answer(e.body).then(
          (reply) => { e.block = number; e.reply = reply.error ? null : reply; },
          () => { e.reply = null; },
        );
      }
    }, 2_000)).unref?.(), () => {});
  }

  // A failed start (no route, or the light client could not bootstrap) is
  // reported through status and to callers, rather than ending the process.
  let startError;
  ready.catch((e) => {
    startError = String(e?.message ?? e).slice(0, 200);
    log({ event: "start-failed", reason: startError });
  });

  function close() {
    closed = true;
    clearInterval(prefetcher);
    reader?.close();
    shaper?.close();
    client?.close();
  }

  return {
    handle,
    close,
    ready,
    status: () => ({ counts, ready: Boolean(reader), ...(reader?.following() ? { following: reader.following() } : {}), ...(startError ? { error: startError } : {}) }),
  };
}
