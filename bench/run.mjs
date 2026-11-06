import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

const env = (k, d) => process.env[k] ?? d;
const ARMS = env("ARMS", "D,N0").split(",");
const SESSIONS = Number(env("SESSIONS", "6"));
const MINUTES = Number(env("MINUTES", "10"));
const REGION = env("REGION", "local");
const TASK = env("CLOUD_RUN_TASK_INDEX", "0");
const PROVIDERS = env("PROVIDERS", "https://ethereum-rpc.publicnode.com,https://rpc.mevblocker.io").split(",");

const root = join(dirname(fileURLToPath(import.meta.url)), "page");
const types = { ".html": "text/html", ".js": "text/javascript" };

function serve() {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    try {
      const body = await readFile(join(root, path === "/" ? "index.html" : path));
      res.writeHead(200, { "content-type": types[extname(path)] ?? "text/html" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// RLP and a signed EIP-1559 Sepolia transfer from a fresh, unfunded key:
// the node rejects it with "insufficient funds", exercising the write path only.
const hexBytes = (n) => { let h = n.toString(16); if (h.length % 2) h = "0" + h; return n === 0n ? new Uint8Array() : Uint8Array.from(Buffer.from(h, "hex")); };
const rlpLen = (len, off) => len < 56 ? Uint8Array.of(off + len) : (() => { const l = hexBytes(BigInt(len)); return Uint8Array.of(off + 55 + l.length, ...l); })();
const rlp = (x) => {
  if (Array.isArray(x)) { const b = Buffer.concat(x.map(rlp)); return Buffer.concat([rlpLen(b.length, 0xc0), b]); }
  const b = typeof x === "bigint" ? hexBytes(x) : x;
  return b.length === 1 && b[0] < 0x80 ? Buffer.from(b) : Buffer.concat([rlpLen(b.length, 0x80), b]);
};
function unfundedSepoliaTx() {
  const key = secp256k1.utils.randomPrivateKey();
  const addr = keccak_256(secp256k1.getPublicKey(key, false).slice(1)).slice(12);
  const fields = [11155111n, 0n, 1_000_000_000n, 30_000_000_000n, 21000n, addr, 0n, new Uint8Array(), []];
  const sig = secp256k1.sign(keccak_256(Buffer.concat([Uint8Array.of(2), rlp(fields)])), key);
  return "0x02" + rlp([...fields, BigInt(sig.recovery), sig.r, sig.s]).toString("hex");
}

const node = ARMS.includes("N1H") ? await import("./node-arms.mjs") : null;
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
console.log(JSON.stringify({ event: "start", region: REGION, arms: ARMS, sessions: SESSIONS, minutes: MINUTES, chromium: browser.version() }));

for (let round = 0; round < SESSIONS; round++) {
  // Each task and round starts with a different arm, so no arm always pays the cold start.
  const order = ARMS.map((_, i) => ARMS[(i + Number(TASK) + round) % ARMS.length]);
  for (const arm of order) {
    const url = PROVIDERS[(Number(TASK) * SESSIONS + round) % PROVIDERS.length];
    const context = await browser.newContext();
    const page = await context.newPage();
    const started = new Date().toISOString();
    const opts = { arm, url, minutes: MINUTES, rawTx: unfundedSepoliaTx() };
    try {
      let result;
      if (node?.NODE_ARMS.has(arm)) {
        result = await node.runInNode(opts);
      } else {
        await page.goto(base);
        await page.waitForFunction(() => typeof window.runSession === "function");
        result = await page.evaluate((o) => window.runSession(o), opts);
      }
      console.log(JSON.stringify({ event: "session", region: REGION, task: TASK, round, started, ...result }));
    } catch (e) {
      console.log(JSON.stringify({ event: "session", region: REGION, task: TASK, round, started, arm, url, error: String(e?.message ?? e).slice(0, 200) }));
    } finally {
      await context.close();
    }
  }
}

await browser.close();
server.close();
console.log(JSON.stringify({ event: "done", region: REGION }));
