import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT ?? 8545);
const HOST = process.env.HOST ?? "127.0.0.1";
const CHECKPOINT = process.env.ATMOS_CHECKPOINT;
const CHAIN_ID = "11155111";
const MAX_BATCH = 20;
const MAX_INFLIGHT_PER_IP = 20;

if (!/^0x[0-9a-fA-F]{64}$/.test(CHECKPOINT ?? "")) {
  console.error("ATMOS_CHECKPOINT must be a trusted Sepolia beacon block root (0x + 64 hex)");
  process.exit(1);
}

// The page that holds the anonymity worker is served on a private loopback port.
const root = join(dirname(fileURLToPath(import.meta.url)), "page");
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
await page.addInitScript((cp) => { window.ATMOS_CHECKPOINT = cp; }, CHECKPOINT);
await page.goto(`http://127.0.0.1:${pageServer.address().port}/`);
await page.waitForFunction(() => typeof window.atmosHandle === "function");

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const inflight = new Map();

async function answer(call) {
  if (call?.jsonrpc !== "2.0" || typeof call.method !== "string") return rpcError(call?.id, -32600, "invalid request");
  try {
    return await page.evaluate((b) => window.atmosHandle(b), call);
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
    return send(res, 200, { name: "atmos-host", chains: [Number(CHAIN_ID)], ...(await page.evaluate(() => window.atmosStatus())) });
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
