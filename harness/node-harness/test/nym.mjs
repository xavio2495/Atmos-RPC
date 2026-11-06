// Boots the live, hash-pinned Nym worker in this harness and sends one
// JSON-RPC call through the mixnet. Needs network access and takes a minute.
import { AnonRpcWorker } from "../dist/host.js";

const NYM = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
const BOOTSTRAP = process.env.BOOTSTRAP ?? "https://rpc.mevblocker.io";
const TARGET = process.env.TARGET ?? "https://ethereum-rpc.publicnode.com";

const rpcProvider = {
  request: async ({ method, params }) => {
    const r = await fetch(BOOTSTRAP, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    });
    return (await r.json()).result;
  },
};

const t0 = performance.now();
const s = () => ((performance.now() - t0) / 1000).toFixed(1) + "s";
const worker = new AnonRpcWorker({
  address: NYM,
  preExisting: { rpcProvider },
  capabilities: { fetch: true, webSocket: true, web: true },
  limits: { memoryBytes: 1024 * 1024 * 1024, deadlineMs: 60_000 },
  bundleCacheDir: process.env.BUNDLE_CACHE ?? "/tmp/anon-rpc-bundles",
});
const timer = setTimeout(() => { console.log(s(), "TIMEOUT"); worker.close(); process.exit(2); }, 240_000);
try {
  await worker.ready;
  console.log(s(), "ready");
  for (let i = 0; i < 3; i++) {
    const c0 = performance.now();
    const res = await worker.fetch(TARGET, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    console.log(s(), `call ${i + 1}:`, res.status, (await res.text()).slice(0, 80), Math.round(performance.now() - c0) + "ms");
  }
} catch (e) {
  console.log(s(), "FAILED:", e?.message ?? e);
} finally {
  clearTimeout(timer);
  worker.close();
}
