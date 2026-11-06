import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT ?? 8545);
const HOST = process.env.HOST ?? "127.0.0.1";
const CHECKPOINT = process.env.ATMOS_CHECKPOINT;
const CHAIN_ID = "11155111";
const MAX_BATCH = 20;
const MAX_INFLIGHT_PER_IP = 20;
// "node": the worker runs in the Node harness (a V8 isolate), no browser.
// "chromium": it runs in the browser harness inside headless Chromium.
const RUNTIME = process.env.ATMOS_RUNTIME ?? "node";
// Constant-rate schedule for all outgoing calls (see core.js). Off by default.
const SHAPE = process.env.ATMOS_SHAPE === "1";

if (!/^0x[0-9a-fA-F]{64}$/.test(CHECKPOINT ?? "")) {
  console.error("ATMOS_CHECKPOINT must be a trusted Sepolia beacon block root (0x + 64 hex)");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const { handle, status } = RUNTIME === "node" ? await startNode() : await startChromium();

async function startNode() {
  const { startAtmos } = await import("./dist/core.node.js");
  const { AnonRpcWorker } = await import("../harness/node-harness/dist/host.js");
  // The Nym worker is built for a browser: it needs WebAssembly room, a WebSocket
  // and the browser platform pieces, all granted by the Node harness.
  class NymWorker extends AnonRpcWorker {
    constructor(init) {
      super({
        ...init,
        capabilities: { fetch: true, webSocket: true, web: true },
        limits: { memoryBytes: 1024 * 1024 * 1024, deadlineMs: 60_000 },
        bundleCacheDir: process.env.ATMOS_BUNDLE_CACHE ?? join(here, ".bundles"),
      });
    }
  }
  const traceFile = process.env.ATMOS_TRACE;
  const trace = traceFile ? (e) => appendFileSync(traceFile, JSON.stringify(e) + "\n") : undefined;
  // With tracing on, also record each request body as it enters the tunnel.
  if (trace) {
    const fetch = NymWorker.prototype.fetch;
    NymWorker.prototype.fetch = function (url, init) {
      trace({ t: Date.now(), wire: true, host: new URL(url).host, body: init?.body ? String(init.body).length : 0 });
      return fetch.call(this, url, init);
    };
  }
  const atmos = startAtmos({ checkpoint: CHECKPOINT, Worker: NymWorker, shape: SHAPE, trace });
  return { handle: atmos.handle, status: atmos.status };
}

// The page that holds the worker is served on a private loopback port.
async function startChromium() {
  const { chromium } = await import("playwright");
  const root = join(here, "page");
  const pageServer = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
      const body = await readFile(join(root, path === "/" ? "index.html" : path));
      res.writeHead(200, { "content-type": extname(path) === ".js" ? "text/javascript" : "text/html" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok) => pageServer.listen(0, "127.0.0.1", ok));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", (m) => console.log(m.text()));
  await page.addInitScript(([cp, shape]) => { window.ATMOS_CHECKPOINT = cp; window.ATMOS_SHAPE = shape; }, [CHECKPOINT, SHAPE]);
  await page.goto(`http://127.0.0.1:${pageServer.address().port}/`);
  await page.waitForFunction(() => typeof window.atmosHandle === "function");
  return {
    handle: (b) => page.evaluate((x) => window.atmosHandle(x), b),
    status: () => page.evaluate(() => window.atmosStatus()),
  };
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const inflight = new Map();

async function answer(call) {
  if (call?.jsonrpc !== "2.0" || typeof call.method !== "string") return rpcError(call?.id, -32600, "invalid request");
  try {
    return await handle(call);
  } catch (e) {
    return rpcError(call.id, -32603, String(e?.message ?? e).split("\n")[0].slice(0, 200));
  }
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  }).end(JSON.stringify(body));
}

// No request is logged with its address; only aggregate counts are kept.
createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname.replace(/\/$/, "");
  if (req.method === "OPTIONS") return send(res, 204, null);
  if (req.method === "GET" && path === "") {
    return send(res, 200, { name: "atmos-host", chains: [Number(CHAIN_ID)], runtime: RUNTIME, shaped: SHAPE, ...(await status()) });
  }
  if (req.method !== "POST" || path !== `/${CHAIN_ID}`) return send(res, 404, rpcError(null, -32601, "use POST /" + CHAIN_ID));

  const ip = req.socket.remoteAddress;
  if ((inflight.get(ip) ?? 0) >= MAX_INFLIGHT_PER_IP) return send(res, 429, rpcError(null, -32005, "too many requests"));
  inflight.set(ip, (inflight.get(ip) ?? 0) + 1);
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { return send(res, 200, rpcError(null, -32700, "parse error")); }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0 || parsed.length > MAX_BATCH) return send(res, 200, rpcError(null, -32600, `batch size 1..${MAX_BATCH}`));
      return send(res, 200, await Promise.all(parsed.map(answer)));
    }
    send(res, 200, await answer(parsed));
  } finally {
    const n = inflight.get(ip) - 1;
    n ? inflight.set(ip, n) : inflight.delete(ip);
  }
}).listen(PORT, HOST, () => console.log(JSON.stringify({ event: "listening", url: `http://${HOST}:${PORT}/${CHAIN_ID}` })));
