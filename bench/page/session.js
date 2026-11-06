import { AnonRpcWorker } from "@anon-rpc/browser-harness";
import { createAtmosClient } from "../../client/atmos.js";
import { v2Arms } from "./arms-v2.js";

const NYM_SPECIFIER = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
const BOOTSTRAP_RPC = "https://ethereum-rpc.publicnode.com";
const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const CALL_TIMEOUT_MS = 24_000;
const BOOT_TIMEOUT_MS = 180_000;

const WATCHED = [
  "0x00000000219ab540356cBB839Cbe05303d7705Fa",
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
];
const USDC = WATCHED[3];
const HOLDER = "0x55FE002aefF02F77364de339a1292923A15844B8";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (id, method, params = []) => ({ jsonrpc: "2.0", id, method, params });

function bootstrapProvider() {
  return {
    request: async ({ method, params }) => {
      const r = await fetch(BOOTSTRAP_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rpc(1, method, params ?? [])),
      });
      return (await r.json()).result;
    },
  };
}

// One timed JSON-RPC POST. `ok` means every requested result came back.
const fetchSender = (doFetch) => (url, body) =>
  doFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

async function timedCall(send, url, body, t0, log) {
  const start = performance.now();
  let ok = false, err;
  try {
    const res = await Promise.race([
      send(url, body),
      sleep(CALL_TIMEOUT_MS).then(() => { throw new Error("timeout"); }),
    ]);
    const items = Array.isArray(res) ? res : [res];
    ok = items.length > 0 && items.every((x) => x && x.result !== undefined);
    if (!ok) err = String(items.find((x) => x && x.error)?.error?.message ?? "no result").slice(0, 80);
  } catch (e) {
    err = String(e?.message ?? e).slice(0, 80);
  }
  const end = performance.now();
  const entry = { at: Math.round(start - t0), ms: Math.round(end - start), ok, err };
  log.push(entry);
  return entry;
}

const burstBodies = () => [
  ...WATCHED.map((a, i) => rpc(i + 1, "eth_getBalance", [a, "latest"])),
  rpc(9, "eth_blockNumber"),
  rpc(10, "eth_getTransactionCount", [WATCHED[0], "latest"]),
];

const actionBodies = (id) => [
  rpc(id, "eth_call", [{ to: USDC, data: "0x70a08231" + HOLDER.slice(2).toLowerCase().padStart(64, "0") }, "latest"]),
  rpc(id + 1, "eth_estimateGas", [{ from: HOLDER, to: HOLDER, value: "0x0" }]),
];

// Requests go out the way a wallet issues them, in parallel; the sender decides how they travel.
async function workload(send, url, minutes, rawTx, t0, out) {
  const burstStart = performance.now();
  const burst = await Promise.all(burstBodies().map((b) => timedCall(send, url, b, t0, out.calls)));
  out.burst = { wallMs: Math.round(performance.now() - burstStart), ok: burst.filter((c) => c.ok).length, of: burst.length };

  const end = performance.now() + minutes * 60_000;
  const actionTimes = [0.2, 0.5, 0.8].map((f) => performance.now() + f * minutes * 60_000);
  let id = 100, tick = 0, writeDone = false;
  while (performance.now() < end) {
    const due = [rpc(id++, "eth_blockNumber")];
    if (tick % 3 === 0) due.push(rpc(id++, "eth_getBalance", [WATCHED[tick % WATCHED.length], "latest"]));
    if (actionTimes.length && performance.now() >= actionTimes[0]) { actionTimes.shift(); due.push(...actionBodies(id)); id += 2; }
    const tasks = due.map((b) => timedCall(send, url, b, t0, out.steady));
    if (!writeDone && performance.now() > end - minutes * 30_000) {
      writeDone = true;
      tasks.push(timedCall(send, SEPOLIA_RPC, rpc(id++, "eth_sendRawTransaction", [rawTx]), t0, out.write));
    }
    await Promise.all(tasks);
    tick++;
    await sleep(12_000);
  }
}

async function bootNym(t0, out) {
  const worker = new AnonRpcWorker({ address: NYM_SPECIFIER, preExisting: { rpcProvider: bootstrapProvider() } });
  try {
    await Promise.race([worker.ready, sleep(BOOT_TIMEOUT_MS).then(() => { throw new Error("boot timeout"); })]);
    out.boot.readyMs = Math.round(performance.now() - t0);
    return worker;
  } catch (e) {
    out.boot.error = String(e?.message ?? e).slice(0, 80);
    worker.close();
    return null;
  }
}

const ARMS = {
  async D(opts, t0, out) {
    out.boot.readyMs = 0;
    await workload(fetchSender(fetch.bind(globalThis)), opts.url, opts.minutes, opts.rawTx, t0, out);
  },
  async N0(opts, t0, out) {
    const worker = await bootNym(t0, out);
    if (!worker) return;
    try {
      await workload(fetchSender(worker.fetch.bind(worker)), opts.url, opts.minutes, opts.rawTx, t0, out);
    } finally {
      worker.close();
    }
  },
  async N1(opts, t0, out, Worker, onReady) {
    out.events = [];
    let client;
    try {
      client = await createAtmosClient({
        bootstrapProvider: bootstrapProvider(),
        probeUrl: opts.url,
        Worker,
        log: (e) => out.events.push({ at: Math.round(performance.now() - t0), ...e }),
      });
    } catch (e) {
      out.boot.error = String(e?.message ?? e).slice(0, 80);
      return;
    }
    out.boot.readyMs = Math.round(performance.now() - t0);
    onReady?.();
    try {
      await workload((url, body) => client.request(url, body), opts.url, opts.minutes, opts.rawTx, t0, out);
    } finally {
      client.close();
    }
  },
  // N1 with a fault: halfway through the workload, the worker that served the latest call stops answering.
  async N1F(opts, t0, out) {
    let last = null;
    const stalled = new WeakSet();
    class StallableWorker extends AnonRpcWorker {
      constructor(init) {
        super(init);
        const real = this.fetch;
        this.fetch = (...args) => {
          last = this;
          return stalled.has(this) ? new Promise(() => {}) : real(...args);
        };
      }
    }
    const injectFault = () => setTimeout(() => {
      if (!last) return;
      stalled.add(last);
      out.events.push({ at: Math.round(performance.now() - t0), event: "fault-injected" });
    }, opts.minutes * 30_000);
    await ARMS.N1(opts, t0, out, StallableWorker, injectFault);
  },
};
Object.assign(ARMS, v2Arms({ workload, bootstrapProvider }));

window.runSession = async (opts) => {
  const t0 = performance.now();
  const out = { arm: opts.arm, url: opts.url, boot: {}, calls: [], steady: [], write: [] };
  if (!ARMS[opts.arm]) throw new Error(`unknown arm ${opts.arm}`);
  await ARMS[opts.arm](opts, t0, out);
  const okAt = [...out.calls, ...out.steady].filter((c) => c.ok).map((c) => c.at + c.ms);
  out.boot.firstOkMs = okAt.length ? Math.min(...okAt) : null;
  out.totalMs = Math.round(performance.now() - t0);
  return out;
};

export { ARMS };
