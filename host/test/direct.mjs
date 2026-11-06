// Direct checks of the verifier and the local EVM against a Sepolia provider,
// without the mixnet: results must equal the provider's, forgeries must fail.
import { createVerifiedReader, SEPOLIA } from "../../client/verify.js";
import { createExecutor } from "../../client/evm.js";
import { createReceiptChecker } from "../../client/receipts.js";

const U = "https://sepolia.gateway.tenderly.co";
const BEACON = "https://lodestar-sepolia.chainsafe.io";
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p) => fetch(BEACON + p).then((r) => r.json());
const checkpoint = (await get("/eth/v1/beacon/headers/finalized")).data.root;
const reader = await createVerifiedReader({ request: post, beaconGet: get, checkpoint, providers: [U], chain: SEPOLIA });
const ex = createExecutor({ reader, chainId: SEPOLIA.chainId });
let failed = 0;
const check = (ok, what) => { console.log(ok ? "  ✓" : "  ✗", what); if (!ok) failed++; };

const WETH = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14", USDC = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", UNI = "0x1f9840a85d5af5bf1d1762f925bddadc4201f984";
const holders = ["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead", WETH, "0x7b79995e5f793a07bc00c21412e50ecae098e7f9"];
const pad = (a) => a.slice(2).padStart(64, "0");
const calls = [];
for (const t of [WETH, USDC, UNI]) {
  calls.push({ to: t, data: "0x18160ddd" }, { to: t, data: "0x313ce567" }, { to: t, data: "0x95d89b41" }, { to: t, data: "0x06fdde03" });
  for (const h of holders) calls.push({ to: t, data: "0x70a08231" + pad(h) });
  calls.push({ to: t, data: "0xdd62ed3e" + pad(holders[0]) + pad(holders[1]) });
}
let same = 0;
const t0 = performance.now();
for (const c of calls) {
  await new Promise((r) => setTimeout(r, 400)); // paced: a free provider throttles bursts
  const block = "0x" + (await reader.head()).number.toString(16);
  const mine = await ex.call(c).catch((e) => "ERR " + e.message);
  // The reference answer is retried when the provider throttles, so a rate limit
  // is not mistaken for a wrong local result.
  let theirs;
  for (let i = 0; i < 4; i++) {
    theirs = await post(U, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [c, block] });
    if (!/rate limit/i.test(theirs.error?.message ?? "")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const expected = theirs.result ?? "ERR " + theirs.error?.message;
  if (mine === expected) same++;
  else console.log(`    differs at ${block}: ${c.to.slice(0, 10)} ${c.data.slice(0, 10)}: ${String(mine).slice(0, 70)} vs ${String(expected).slice(0, 70)}`);
}
const perCall = Math.round((performance.now() - t0) / calls.length);
check(same === calls.length, `local eth_call equals the provider's on ${same}/${calls.length} calls (${perCall - 400} ms per call, direct)`);

// Receipts: real ones prove against the block's receipts root; a tampered log does not.
{
  const head = await reader.head();
  const blk = (await post(U, { jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: ["0x" + (head.number - 3).toString(16), false] })).result;
  const txs = blk.transactions.slice(0, 3);
  const rc = createReceiptChecker({ reader });
  const proven = (await Promise.all(txs.map((h) => rc.receipt(h).then((r) => r?.transactionHash === h, () => false)))).filter(Boolean).length;
  check(proven === txs.length, `receipts prove against the receipts root (${proven}/${txs.length})`);
  const tampering = await createVerifiedReader({
    request: async (u, b) => { const r = await post(u, b); if (b.method === "eth_getBlockReceipts") { const x = r.result.find((y) => y.logs.length); if (x) x.logs[0].data = "0x" + "00".repeat(32); } return r; },
    beaconGet: get, checkpoint, providers: [U], chain: SEPOLIA,
  });
  const bad = await createReceiptChecker({ reader: tampering }).receipt(txs[0]).then(() => "accepted", (e) => e.message);
  check(bad !== "accepted", `a tampered receipt log is rejected (${bad})`);
  tampering.close();
}

const forged = await createVerifiedReader({
  request: async (u, b) => { const r = await post(u, b); if (b.method === "eth_getBlockByHash" && r.result) r.result.stateRoot = "0x" + "11".repeat(32); return r; },
  beaconGet: get, checkpoint, providers: [U], chain: SEPOLIA,
}).then(() => "accepted", (e) => e.message);
check(forged !== "accepted", `a forged header is rejected (${forged})`);

const lying = await createVerifiedReader({
  request: async (u, b) => { const r = await post(u, b); if (b.method === "eth_getCode") r.result = r.result.slice(0, -2) + "00"; return r; },
  beaconGet: get, checkpoint, providers: [U], chain: SEPOLIA,
});
const code = await lying.request(U, { jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [WETH, "latest"] });
check(Boolean(code.error), `wrong code is rejected (${code.error?.message ?? "accepted"})`);
lying.close(); forged?.close?.();

// Mainnet (Electra/Fulu head format): verified reads equal the provider's at the same block.
{
  const { MAINNET } = await import("../../client/verify.js");
  const M = "https://ethereum-rpc.publicnode.com", MB = "https://ethereum-beacon-api.publicnode.com";
  const mget = (p) => fetch(MB + p).then((r) => r.json());
  const mcp = (await mget("/eth/v1/beacon/headers/finalized")).data.root;
  const m = await createVerifiedReader({ request: post, beaconGet: mget, checkpoint: mcp, providers: ["https://rpc.mevblocker.io", M], chain: MAINNET });
  const block = "0x" + (await m.head()).number.toString(16);
  const reads = [
    ["eth_getBalance", ["0x00000000219ab540356cBB839Cbe05303d7705Fa"]],
    ["eth_getTransactionCount", ["0x55FE002aefF02F77364de339a1292923A15844B8"]],
    ["eth_getStorageAt", ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0x0"]],
    ["eth_getCode", ["0x6B175474E89094C44Da98b954EedeAC495271d0F"]],
  ];
  let ok = 0;
  for (const [method, args] of reads) {
    const mine = (await m.request(M, { jsonrpc: "2.0", id: 1, method, params: [...args, "latest"] })).result;
    const theirs = (await post("https://rpc.mevblocker.io", { jsonrpc: "2.0", id: 1, method, params: [...args, block] })).result;
    if (mine === theirs) ok++;
    else console.log(`    differs: ${method} ${String(mine).slice(0, 50)} vs ${String(theirs).slice(0, 50)}`);
  }
  check(ok === reads.length, `mainnet verified reads equal the provider's at the same block (${ok}/${reads.length})`);
  m.close();
}

reader.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
