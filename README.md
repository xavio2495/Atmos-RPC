<div align="center">
<img width="120" alt="Atmos" src="./web/static/favicon.svg" />

# Atmos-RPC

### **Private, verified Ethereum RPC over the Nym mixnet: faster than stock anon-rpc, checked against a light client**

<br>

[![SDK: MIT](https://img.shields.io/badge/SDK-MIT-3fcfaa?style=flat-square)](./sdk/package.json)
[![Network: Sepolia](https://img.shields.io/badge/Network-Sepolia-222222?style=flat-square&logo=ethereum&logoColor=white)](https://sepolia.etherscan.io)
[![anon-rpc 0.4.0](https://img.shields.io/badge/anon--rpc-0.4.0-222222?style=flat-square)](https://github.com/ethereum/anon-rpc)
[![Nym mixnet](https://img.shields.io/badge/Transport-Nym_mixnet-222222?style=flat-square)](https://nym.com)
[![Node 24](https://img.shields.io/badge/Node-24-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)](#development)
[![EIP-1193](https://img.shields.io/badge/Provider-EIP--1193-222222?style=flat-square)](#use-it)
[![Ethereum Foundation · Best Use of Anon-RPC](https://img.shields.io/badge/Ethereum_Foundation-Best_Use_of_Anon--RPC-3fcfaa?style=flat-square&logo=ethereum&logoColor=white)](#sponsor-integration-ethereum-foundation--anon-rpc)

<br>

**[Sponsor](#sponsor-integration-ethereum-foundation--anon-rpc)** · **[Background](#the-background)** · **[What it does](#what-it-does)** · **[Use it](#use-it)** · **[Architecture](#architecture)** · **[Request flow](#request-flow)** · **[Results](#results)** · **[What is verified](#what-is-verified)** · **[Where it lives](#where-it-lives)** · **[Develop](#development)** · **[License](#license)**

<br><br><br>
</div>

**Atmos** is a client layer on top of **[anon-rpc](https://github.com/ethereum/anon-rpc)**, the standard for sending a wallet's Ethereum RPC calls through an anonymity network from inside a sandboxed worker. It runs the **unmodified Nym worker**, pinned by hash, and adds what anon-rpc leaves to the client: **speed** (batching, route probing, a warm standby), **integrity** (every read checked against a light-client head) and **timing privacy** (an optional constant-rate, padded schedule).

You can use it three ways: as an **EIP-1193 provider** for viem, ethers or wagmi; as **`atmos-host`**, a local RPC URL that MetaMask and other wallets can use as-is; or as the lower-level **client** inside your own code.

> ### ⚠️ Sepolia · research software · unaudited
> Atmos runs on **Sepolia only** and has **not been independently audited**. It holds no keys and moves no funds itself, but do not rely on it for the privacy of mainnet activity yet. Timing results are from a small number of Cloud Run sessions; read them as measured, not guaranteed.

---

## Sponsor integration: Ethereum Foundation · anon-rpc

| Sponsor | Track | What Atmos builds on |
|---|---|---|
| **Ethereum Foundation** | **Best Use of Anon-RPC** | [`ethereum/anon-rpc`](https://github.com/ethereum/anon-rpc) spec 0.4.0: the browser harness, harness-core and the Node harness (forked) |

**anon-rpc** is the Ethereum Foundation's standard for sending a wallet's RPC calls through an anonymity network. A small on-chain **specifier** contract names a worker bundle by its hash and lists where to download it. A **harness** downloads the bundle, checks it against that hash, and runs it in a sandbox. The app then calls `worker.fetch()`, and the worker (here, Nym's) carries the request through the mixnet. Atmos is built entirely on that interface. It never replaces the worker or touches the user's network identity itself; it changes only **what the worker is given and what is done with its answers**.

### Where anon-rpc is used

| anon-rpc part | Used for | In Atmos |
|---|---|---|
| `@anon-rpc/browser-harness` 0.4.0, `AnonRpcWorker` | Runs the Nym worker in a sandboxed, null-origin iframe in the browser (SDK, demo, benchmark) | [`client/atmos.js`](./client/atmos.js) · [`sdk/index.js`](./sdk/index.js) · [`bench/page/session.js`](./bench/page/session.js) |
| `@anon-rpc/node-harness` (forked) and `@anon-rpc/harness-core` 0.4.0 | Runs the same worker in Node with no browser: the default for `atmos-host` and the SDK in Node | [`harness/`](./harness) · [`sdk/node.js`](./sdk/node.js) · [`host/server.mjs`](./host/server.mjs) |
| The Nym specifier `0x3aCD…0eD0` (`workerHash()`, `workerResolvers()`) | Identifies the worker bundle; Atmos pins its hash and resolver list | [`client/atmos.js`](./client/atmos.js) (`NYM_WORKER_HASH`, `pinSpecifier`) |
| `WorkerInit.config` | Chooses the entry gateway and IPR exit per route (`preferredGateway`, `preferredIpr`), and the tunnel's connect timeout | [`client/atmos.js`](./client/atmos.js) (`bootRoute`) |
| `WorkerInit.preExisting.rpcProvider` | The bootstrap provider the harness reads the specifier through; Atmos answers those reads from the pin | [`client/atmos.js`](./client/atmos.js) (`pinSpecifier`) |
| `worker.ready`, `worker.fetch()`, `worker.close()` | Every RPC call, beacon-API request and access-list fetch Atmos makes | [`client/atmos.js`](./client/atmos.js) (`Route`) |
| Stock anon-rpc, unchanged | The baseline every benchmark arm is measured against (arm `N0`) | [`bench/page/session.js`](./bench/page/session.js) |

### How it is used

1. **Boot a route.** Atmos picks an entry gateway and an IPR exit from the Nym directory's top performance band, then creates an `AnonRpcWorker` with them in `config`. It awaits `ready`, then **sends a real `eth_chainId` through the worker**, and only a route that answers is accepted. In our runs, some stock workers reported `ready` and then carried no call at all.
2. **Shape what the worker receives.** Calls issued in the same tick leave as **one JSON-RPC batch**, with one request in flight per provider. Inside the Nym worker each origin has a single pooled connection, so parallel calls would each open a new TCP and TLS connection through the mixnet, one after another.
3. **Keep a warm standby.** A second worker on a different exit is booted and connected to every provider in use. When a call stalls, or the route keeps failing fast, Atmos switches to the standby.
4. **Separate heavy traffic.** Large background fetches (a block's access list) go on their own workers ("bulk lanes"), so they never queue the wallet's calls.
5. **Verify the answers.** Replies from `worker.fetch()` go through a light client: proofs are checked against a verified state root, and `eth_call` runs in a local EVM. A provider that sits behind the mixnet can't lie about state.
6. **Boot silently and safely.** The specifier reads that the harness makes through `preExisting.rpcProvider` are answered from a **pinned hash and resolver list**. No RPC provider learns, from the user's own IP, that this machine is starting the worker, and a lying provider can't substitute the code.

### Forking the Node harness

anon-rpc's Node harness ran workers in QuickJS, which has no WebAssembly or WebSocket, so the Nym worker (a large wasm client that opens a WebSocket to its gateway) couldn't run there. We forked it at upstream [`c8980fb`](./harness/UPSTREAM), kept the upstream test suite passing, and added:

| Change | Commit |
|---|---|
| Workers run in a **V8 isolate** (`isolated-vm`) instead of QuickJS | `591e28d` |
| **WebSocket** and **browser-platform** capabilities (Blob, Worker, MessageChannel, promise forms of WebAssembly), granted per worker | `b09085e` |
| **Blob frames** sent over the bridged WebSocket; before this, every binary frame left empty and the Nym worker never got past its exit handshake | `2cf6c99` |
| **`expectedHash`**: a worker whose specifier hash differs from the pin never boots | `6978494` |
| **Host allowlist** (`network.policy.hosts`), checked before DNS on the fetch, WebSocket and socket bridges | `6978494` |
| **Every redirect hop re-checked** against the allowlist and address policy, and the response size capped while streaming | `2ecf359` |
| WebSocket receive queue capped, listeners attached before `open`, closed sockets freed | `3664750` |
| `getRandomValues` over 65,536 bytes throws instead of returning a partly zero buffer | `609c3f5` |

With the fork, `atmos-host` runs the Nym worker in plain Node at the same speed as headless Chromium: page load 2.8 s vs 3.4 s, typical call 522 ms vs 572 ms, 100% of calls answered in both (Cloud Run run 5).

### Measured against stock anon-rpc

| | Stock anon-rpc (Nym worker) | Atmos on the same worker |
|---|---|---|
| 10-read page load, 3 regions | 14.7–22.0 s | **1.5–3.6 s** |
| Slowest 5% of steady calls | 3.2–7.3 s | **0.9–2.7 s** |
| Route reported ready but dead | 2 of 6 sessions (run 1) | rejected at boot by the probe |
| Time to first answer | 16–33 s | 17–71 s (slower: the route is tested first) |

### Feedback to anon-rpc

We talked with anon-rpc's author during the event and sent these findings privately:
- **Worker loading:** the worker hash is read with one unproven `eth_call`, so a lying bootstrap provider can choose the code. The browser harness iframe has no `connect-src` limit. Every live specifier is owned by a single key. We proposed `WorkerInit.expectedHash` or a required proof; the author suggested a feature request.
- **A confirmed bug:** `worker.fetch()` returns a `Response` with an empty `url`, which breaks libraries that read it. Helios's HTTP client fails with "url parse". The author confirmed it as a bug.
Found while hardening our fork, also present in upstream's Node harness, and not yet reported:
- redirects followed without re-checking the address policy, so a worker allowed one host could be redirected to another, including the host's own network;
- `getRandomValues` over 65,536 bytes leaving a zero tail.

Both are fixed in our fork.

---

## The Background

anon-rpc hides **your IP address** from the RPC provider: calls leave from a mixnet exit, not from your machine. That is necessary, but on its own it isn't anonymity:

- **The provider still sees every query.** Which addresses you look up, which contracts you call, and when, is a fingerprint of its own.
- **The provider can lie.** A plain RPC answer is trusted as-is, so a dishonest or compromised provider can show you the wrong balance, nonce or contract state.
- **The timing leaks.** A wallet's burst of reads on page load, and its polling rhythm afterwards, are visible to anyone watching the exit or the provider.
- **It's slow in practice.** A wallet issues reads in parallel. Through one stock Nym worker, each extra concurrent call waits for a fresh TCP and TLS connection through the mixnet, one after another, so a 10-read page load takes 15–22 s.

**Atmos keeps anon-rpc's model and closes these gaps on the client side.**

1. **Faster.** Concurrent calls to a provider leave as **one JSON-RPC batch** on an already-warm connection. A route is trusted only after a real call succeeds through it, and a **warm standby route** takes over when a call stalls.
2. **Verified.** A **light client** follows the sync committee to a verified head. Balances, nonces, code and storage are checked with `eth_getProof` against its state root, `eth_call` runs in a **local EVM on proven state**, and receipts are checked against the block's receipts root.
3. **More private.** An optional **constant-rate, padded schedule** sends the same number of same-sized requests whether the wallet is busy or idle. Routes rotate on a timer, and the worker's code is pinned by hash and limited to the Nym directory and its own gateway.

---

## What it does

- **Batching:** a wallet's 10 parallel reads leave as one batch instead of 10 serial connection setups.
- **Route probing:** a new route through the mixnet must answer a real call before it carries any traffic; routes that report ready but never answer are dropped.
- **Warm standby and failover:** a second route is kept booted and connected to every provider the client has used, and takes over when the primary stalls.
- **Verified reads:** `eth_getBalance`, `eth_getTransactionCount`, `eth_getCode`, `eth_getStorageAt`, `eth_call`, receipts and headers are checked against a light-client head (see [What is verified](#what-is-verified)).
- **Constant-rate shaping (opt-in):** every call waits for a slot on a fixed clock, padded to 2 KB, with dummies in empty slots.
- **Route rotation:** the self-hosted endpoint replaces its route about every 10 minutes, so no route lasts long enough to become a timing fingerprint.
- **A pinned, confined worker:** the Nym worker's hash is pinned (a lying RPC provider can't swap it), the specifier is never read in the clear at start-up, and in the Node harness the worker can reach only the Nym directory and its own entry gateway.
- **EIP-7928 mode (experimental, opt-in):** keeps accounts you have read current from each block's verified access list, so repeat reads name nothing to a provider. It keeps pace in some sessions and not others.

---

## Use it

### A local RPC URL for MetaMask (`atmos-host`)

```sh
curl -fsSL https://atmos.xavio.dev/install.sh | sh
```

The script checks for Node 24 and git, fetches `client/`, `sdk/`, `harness/` and `host/` into `~/.atmos`, builds them from the committed lockfiles, and offers an optional systemd user service. It touches nothing outside that directory unless you agree to the service. Then add a network to MetaMask:

| Field | Value |
|---|---|
| RPC URL | `http://127.0.0.1:8545/11155111` |
| Chain ID | `11155111` |
| Currency | `SepoliaETH` |

The first answer takes 15–70 s while the host joins the mixnet and verifies the chain head. `GET http://127.0.0.1:8545/` reports readiness and how many answers were verified. Settings:

| Variable | Effect |
|---|---|
| `ATMOS_SHAPE=1` | constant-rate, padded schedule |
| `ATMOS_PREFETCH=1` | re-prove recent reads at each block |
| `ATMOS_BAL=1` | EIP-7928 access-list mode (experimental) |
| `ATMOS_CHECKPOINT=0x…` | your own trust anchor (a Sepolia beacon block root) |
| `ATMOS_ORIGINS=…` | extra browser origins allowed to call the host |
| `ATMOS_PUBLIC=1` | an open host: any host name and any browser origin (default: local only) |
| `ATMOS_RUNTIME=chromium` | run the worker in anon-rpc's browser harness instead of the Node harness |

Docker: `docker build -f host/Dockerfile.node -t atmos-host .` then `docker run -p 127.0.0.1:8545:8545 atmos-host`. Publish on loopback as shown, since a plain `-p 8545:8545` exposes the host to your network.

### The SDK: an EIP-1193 provider

```js
import { createAtmos } from "./sdk/node.js";   // sdk/index.js in the browser
import { createPublicClient, custom } from "viem";
import { sepolia } from "viem/chains";

const atmos = createAtmos();
const client = createPublicClient({ chain: sepolia, transport: custom(atmos) });
console.log(await client.getBalance({ address: "0x…" })); // proven against the verified head
atmos.close();
```

Atmos holds no keys: sign with a local account and send raw transactions. Options: `checkpoint`, `shape`, `prefetch`, `bal`, `log`. Not on npm yet; install `sdk/`'s dependencies in place, and build the harness for Node.

### The client directly

```js
import { createAtmosClient } from "./client/atmos.js";

const atmos = await createAtmosClient({ bootstrapProvider, probeUrl: "https://rpc.mevblocker.io" });
const { result } = await atmos.request("https://rpc.mevblocker.io", { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
```

Optional: `rotateMs`, `padBytes`, `hedgeLambdaMs`, `overflow`, `bulkLanes`, `bulkReplace`, `tunnel`, `nymApis`. All are off by default; the benchmark shows which pay.

---

## Architecture

```mermaid
flowchart TB
    subgraph App["Wallet or dapp"]
        MM["MetaMask<br/>(RPC URL)"]
        Lib["viem · ethers · wagmi<br/>(EIP-1193)"]
    end

    subgraph Atmos["Atmos (on the user's machine)"]
        Host["atmos-host<br/>host/ · POST /11155111"]
        SDK["SDK<br/>sdk/ · createAtmos()"]
        Verify["Verified reader<br/>client/verify.js · evm.js · receipts.js"]
        Shape["Constant-rate shaper (opt-in)<br/>client/shape.js"]
        Client["Atmos client<br/>client/atmos.js<br/>batching · probe · standby · bulk lanes"]
        subgraph Harness["Harness (sandbox)"]
            Node["Node harness, V8 isolate<br/>harness/ (default)"]
            Browser["anon-rpc browser harness<br/>(iframe, in the browser)"]
        end
        Worker["Nym worker 0.1.0<br/>(pinned hash, unmodified)"]
    end

    subgraph Net["Nym mixnet"]
        Gateway["Entry gateway"] --> Mix["3 mix layers"] --> Exit["IPR exit"]
    end

    subgraph Providers["Keyless public RPCs"]
        RPC["publicnode · mevblocker · tenderly"]
        Beacon["Beacon APIs<br/>(sync committee)"]
    end

    MM --> Host --> SDK
    Lib --> SDK
    SDK --> Verify --> Shape --> Client
    Client --> Node --> Worker
    Client --> Browser --> Worker
    Worker -->|"Sphinx packets"| Gateway
    Exit --> RPC
    Exit --> Beacon
```

## Request flow

```mermaid
sequenceDiagram
    actor W as Wallet
    participant H as atmos-host / SDK
    participant V as Verified reader
    participant C as Atmos client
    participant N as Nym mixnet
    participant P as RPC provider

    H->>C: Boot: pinned worker, probe a route, keep a standby
    V->>N: Sync-committee updates (beacon API, via the mixnet)
    V-->>V: Verified head (BLS-checked header, state root)
    W->>H: eth_getBalance(address)
    H->>V: Read at the verified head
    V->>C: eth_getProof(address, head)
    C->>N: Batched with other calls, on a warm route
    N->>P: From the exit, not the user's IP
    P-->>N: Account proof
    N-->>C: Reply
    C-->>V: Proof
    V-->>V: Check the Merkle proof against the state root
    V-->>H: Balance (verified)
    H-->>W: Answer
    Note over C,N: A stalled route fails over to the warm standby
```

---

## Results

Cloud Run, 3 regions (europe-west1, us-east1, asia-south1), 4 sessions per arm per region, 10-minute sessions, keyless providers. Full tables and the session-level CSV/JSON are on the website's benchmarks page.

| | Stock anon-rpc | Atmos |
|---|---|---|
| 10-read page load (median) | 14.7–22.0 s | **1.5–3.6 s** (5.5–6.6× faster) |
| Slowest 5% of steady calls | 3.2–7.3 s | **0.9–2.7 s** (3–5× lower) |
| Calls answered | 100% (some routes dead) | 99–100% |
| Time to first answer | 16–33 s | 17–71 s (slower: Atmos tests its route first) |

- **Against direct RPC:** Atmos adds about 0.5–0.6 s per call, the mixnet round trip. A verified balance adds about 0.5–0.9 s for its proof. The latest block number is answered from the verified head with no wait.
- **Failover:** when a route stalled, Atmos switched to its standby 15–18 s later and lost only the call in flight.
- **Browser or Node:** the Node harness runs the Nym worker at the same speed as headless Chromium.
- **Timing privacy:** with the constant-rate schedule on, an observer of the host's **outgoing requests** told busy windows from idle ones no better than chance. Replies are not padded, and incoming traffic has not been measured.

---

## What is verified

| Method | How it is answered |
|---|---|
| `eth_chainId`, `net_version` | locally |
| `eth_blockNumber` | the verified head, no request |
| `eth_getBalance`, `eth_getTransactionCount`, `eth_getCode`, `eth_getStorageAt` | `eth_getProof` checked against the head's state root |
| `eth_call` | run in a local EVM on proven state |
| `eth_estimateGas` | the provider's figure, with the call proven not to revert |
| `eth_getTransactionReceipt` | checked against the block's receipts root |
| `eth_getBlockByNumber`, `eth_getBlockByHash` | header proven; the transaction list is the provider's |
| `eth_sendRawTransaction` | sent through the mixnet; the returned hash must match |
| anything else | sent through the mixnet unverified, and counted |

---

## Where it lives

### Routing and transport

| Capability | Code |
|---|---|
| **Batching, route probe, warm standby, failover, rotation** | [`client/atmos.js`](./client/atmos.js) |
| **Pinned worker hash and silent boot** (no specifier read in the clear) | [`client/atmos.js`](./client/atmos.js) (`pinSpecifier`) |
| **Bulk lanes** for large background fetches (access lists) | [`client/atmos.js`](./client/atmos.js) (`bulk`) |
| **Node harness**: the Nym worker in a V8 isolate, with a host allowlist | [`harness/node-harness/`](./harness/node-harness) |

### Verification

| Capability | Code |
|---|---|
| **Light client** (sync committee, BLS) and **proof-checked reads** | [`client/verify.js`](./client/verify.js) |
| **`eth_call` on proven state** (`@ethereumjs/evm`) | [`client/evm.js`](./client/evm.js) |
| **Receipts against the receipts root** | [`client/receipts.js`](./client/receipts.js) |
| **EIP-7928 access-list follower** (experimental) | [`client/bal.js`](./client/bal.js) |

### Privacy and delivery

| Capability | Code |
|---|---|
| **Constant-rate, padded schedule** | [`client/shape.js`](./client/shape.js) |
| **EIP-1193 provider** (browser and Node) | [`sdk/`](./sdk) |
| **Local RPC endpoint** for wallets | [`host/`](./host) |
| **Installer** | [`web/static/install.sh`](./web/static/install.sh) |
| **Cloud Run benchmark** | [`bench/`](./bench) |

---

## Repository layout

```
client/   the Atmos client: routing, batching, failover, verified reads, EVM, receipts, shaping
sdk/      createAtmos(): an EIP-1193 provider for the browser and Node
host/     atmos-host: a local JSON-RPC endpoint for Sepolia (POST /11155111)
harness/  a fork of anon-rpc's Node harness on a V8 isolate, able to run the Nym worker
bench/    the Cloud Run benchmark: stock anon-rpc against each Atmos layer, and offline client tests
web/      the website, docs and in-browser demo (SvelteKit, deployed on Vercel)
```

---

## Development

**Prerequisites:** Node 24 and git. Docker is optional (`host/Dockerfile.node`). The benchmark needs a Google Cloud project (`GCP_PROJECT`).

```sh
# Harness (needed by the host, the SDK in Node, and the bench's Node arm)
cd harness && npm ci && npm run build && npm test

# Host
cd host && npm ci && npm run build && npm start        # http://127.0.0.1:8545/11155111
npm run test:direct                                     # verified reads, eth_call, receipts, tamper cases

# Client: offline behaviour and regression tests
cd bench && npm ci && npm test

# Benchmark: one local session, or Cloud Run in three regions
cd bench && npm run build && ARMS=N1 SESSIONS=1 MINUTES=2 node run.mjs
GCP_PROJECT=<project> bench/deploy-run.sh <tag> <job> D,N0,N1 4 1 europe-west1 us-east1 asia-south1

# Website
cd web && npm ci && npm run check && npm run build
```

Security findings in anon-rpc's worker loading (an unproven worker-hash read, no egress limits in the browser harness, single-key specifier owners) were reported privately to its author. The client-side fixes (the hash pin and the egress allowlist) are in this repository.

---

## License

The SDK is MIT-licensed ([`sdk/package.json`](./sdk/package.json)). The harness fork keeps anon-rpc's MIT licence ([`harness/LICENSE`](./harness/LICENSE)), with its upstream commit in [`harness/UPSTREAM`](./harness/UPSTREAM).

> **Research software:** provided "as is", without warranty of any kind. Atmos has not been independently audited.

---

<br><br>

<div align="center">

<h3>Built By

[Immanuel](https://github.com/xavio2495)

</h3>
</div>
