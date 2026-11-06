import { createAtmosClient } from "../client/atmos.js";
import { createVerifiedReader, SEPOLIA } from "../client/verify.js";
import { createExecutor } from "../client/evm.js";
import { createReceiptChecker } from "../client/receipts.js";
import { createShaper } from "../client/shape.js";

const BOOTSTRAP_RPC = "https://ethereum-rpc.publicnode.com";
const BEACON = "https://lodestar-sepolia.chainsafe.io";
// tenderly serves proofs a few blocks behind head; publicnode only at head.
const PROVIDERS = ["https://sepolia.gateway.tenderly.co", "https://ethereum-sepolia-rpc.publicnode.com"];
const LOCAL = {
  eth_chainId: "0x" + SEPOLIA.chainId.toString(16),
  net_version: String(SEPOLIA.chainId),
  web3_clientVersion: "atmos-host/0.1",
};

// The worker bootstraps from mainnet: its hash is read from the mainnet registry.
const bootstrapProvider = {
  request: async ({ method, params }) => {
    const r = await fetch(BOOTSTRAP_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    });
    return (await r.json()).result;
  },
};

const latest = (tag) => tag === undefined || tag === "latest";

// The host's RPC logic, the same under either runtime: in a browser page with the
// browser harness, or in Node with the Node harness (`Worker`).
// `shape`: every call leaves in fixed-size batches on a fixed clock (constant-rate
// schedule), so call timing and count stop showing activity. Costs latency.
export function startAtmos({ checkpoint, Worker, shape = false, log = (e) => console.log(JSON.stringify(e)) }) {
  // "advisory": the call is proven not to revert, but the gas figure is the provider's.
  const counts = { verified: 0, advisory: 0, plain: 0, local: 0, failed: 0 };
  let reader, client, executor, receipts, transport;

  const ready = (async () => {
    client = await createAtmosClient({ bootstrapProvider, probeUrl: PROVIDERS[0], log, ...(Worker ? { Worker } : {}) });
    const send = shape ? createShaper({ request: client.request }).request : client.request;
    transport = send;
    reader = await createVerifiedReader({
      request: send,
      beaconGet: (path) => client.fetch(BEACON + path).then((r) => r.json()),
      checkpoint,
      providers: PROVIDERS,
      chain: SEPOLIA,
      log,
    });
    executor = createExecutor({ reader, chainId: SEPOLIA.chainId });
    receipts = createReceiptChecker({ reader });
  })();

  // eth_call and eth_estimateGas run locally on proven state; null means "not handled here".
  async function execute(body) {
    const [tx, tag] = body.params ?? [];
    if (!tx || !latest(tag)) return null;
    if (body.method === "eth_call") {
      try {
        const result = await executor.call(tx);
        counts.verified++;
        return { jsonrpc: "2.0", id: body.id, result };
      } catch (e) {
        if (e.code !== 3) throw e;
        counts.verified++;
        return { jsonrpc: "2.0", id: body.id, error: { code: 3, message: e.message, data: e.data } };
      }
    }
    const estimate = await reader.hint({ jsonrpc: "2.0", id: body.id, method: "eth_estimateGas", params: [tx] });
    const result = await executor.estimateGas(tx, estimate);
    counts.advisory++;
    return { jsonrpc: "2.0", id: body.id, result };
  }

  // One JSON-RPC call in, one response out. Calls the verifier can't check go to
  // the first provider unverified and are counted, so the host's share is visible.
  async function handle(body) {
    await ready;
    if (body.method in LOCAL) {
      counts.local++;
      return { jsonrpc: "2.0", id: body.id, result: LOCAL[body.method] };
    }
    if (body.method === "eth_getTransactionReceipt") {
      const result = await receipts.receipt(body.params[0]);
      counts[result ? "verified" : "advisory"]++;
      return { jsonrpc: "2.0", id: body.id, result };
    }
    if (body.method === "eth_call" || body.method === "eth_estimateGas") {
      const r = await execute(body);
      if (r) return r;
    }
    try {
      const r = await reader.request(PROVIDERS[0], body);
      counts[r.error ? "failed" : "verified"]++;
      return r;
    } catch (e) {
      if (!String(e?.message).startsWith("not verifiable")) throw e;
      counts.plain++;
      return transport(PROVIDERS[0], body);
    }
  }

  return { handle, status: () => ({ counts, ready: Boolean(reader) }), ready };
}
