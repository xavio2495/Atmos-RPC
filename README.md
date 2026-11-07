# ATMOS-RPC

Atmos is a client layer on top of [anon-rpc](https://github.com/ethereum/anon-rpc), the standard for routing a wallet's Ethereum RPC calls through an anonymity network from inside a sandboxed worker. It runs the unmodified, hash-pinned Nym worker, and adds what anon-rpc leaves to the client:

- **Speed and reliability.** Concurrent calls to a provider leave as one JSON-RPC batch, a route is trusted only after a real call succeeds through it, and a warm standby takes over when a call stalls.
- **Integrity.** A light client follows the sync committee to a trusted head. Balances, nonces, code and storage are checked against it with `eth_getProof`, `eth_call` runs locally on proven state, and receipts are checked against the block.
- **Timing.** An optional constant-rate schedule sends padded batches at a fixed rhythm.
- **Wallets that only take a URL.** `atmos-host` gives MetaMask and similar wallets an ordinary RPC URL, and can run on your own machine.

## Results

Measured on Cloud Run with headless sessions (full tables on the website's benchmarks page):

- **Speed:** a burst of ten parallel reads took 2.3–3.3 s with Atmos against 18.8 s to over 24 s with stock anon-rpc, across three regions, and Atmos answered 99–100 % of calls.
- **Verified reads:** every read proof-checked, with a 3.55 s burst and 1.43 s p95 (europe-west1).
- **No browser needed:** the Node harness runs the Nym worker at the same speed as headless Chromium, with the worker's hash pinned and its network limited to the Nym API and its entry gateway.
- **Anonymity:** with the constant-rate schedule on, an observer of the outgoing requests told busy from idle no better than chance. Replies are not padded, and incoming traffic has not been measured.

## Layout

| Path | What |
|---|---|
| `client/atmos.js` | v1 client: route choice, probe before trust, standby and failover, per-provider batching, careful writes |
| `client/verify.js` | light client and proof-checked reads (mainnet and Sepolia, including Gloas) |
| `client/evm.js` | `eth_call` and gas checks on proven state, with `@ethereumjs/evm` |
| `client/receipts.js` | receipts checked against the block's receipts root |
| `client/shape.js` | constant-rate, padded schedule |
| `host/` | `atmos-host`: a self-hostable JSON-RPC endpoint for Sepolia (`POST /11155111`) |
| `harness/` | a fork of anon-rpc's Node harness on a V8 isolate, with the grants a browser-built worker needs; runs the Nym worker with no browser |
| `bench/` | the Cloud Run benchmark: stock anon-rpc against each Atmos layer |
| `web/` | the website and docs |

## Quick start: a local endpoint for a wallet

Requires Node 24 and a trusted Sepolia beacon block root (a recent finalized root, checked against more than one source).

```sh
cd harness && npm install && npm run build && cd ..
cd host
npm install
npm run build
ATMOS_CHECKPOINT=0x… npm start
```

Point the wallet at `http://127.0.0.1:8545/11155111` as an RPC URL for Sepolia. `GET /` reports whether the host is ready and how many answers were verified. In a 5-minute wallet-style session the host answered 73 of 73 calls, 69 of them proof-checked.

The worker runs in the Node harness by default. `ATMOS_RUNTIME=chromium` runs it in anon-rpc's browser harness instead (`npx playwright install chromium` first). `ATMOS_SHAPE=1` sends every call on a constant-rate, padded schedule, at a latency cost. The host answers only on a loopback name and to wallet extensions; `ATMOS_PUBLIC=1` opens it to any host name and origin. Docker: `docker build -f host/Dockerfile.node -t atmos-host .`

## Using the client directly

```js
import { createAtmosClient } from "./client/atmos.js";

const atmos = await createAtmosClient({ bootstrapProvider, probeUrl: "https://rpc.mevblocker.io" });
const { result } = await atmos.request("https://rpc.mevblocker.io", {
  jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [],
});
```

The website's docs cover the client API, the wallet guide, routing and batching, self-hosting and the Node harness.

## Tests

| Test | Command |
|---|---|
| Harness, upstream suite on the V8 sandbox | `cd harness/node-harness && npm test` |
| Nym boot in the Node harness | `cd harness/node-harness && node --dns-result-order=ipv4first test/nym.mjs` |
| Benchmark, one local session | `cd bench && npm run build && ARMS=N1 SESSIONS=1 MINUTES=2 node run.mjs` |
| Website | `cd web && npm run check && npm run build` |

## Licence

The harness fork keeps anon-rpc's MIT licence (`harness/LICENSE`, upstream commit in `harness/UPSTREAM`).
