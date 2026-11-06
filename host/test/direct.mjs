// Direct checks of the verifier and the local EVM against a Sepolia provider,
// without the mixnet: results must equal the provider's, forgeries must fail.
import { createVerifiedReader, SEPOLIA } from "../../client/verify.js";
import { createExecutor } from "../../client/evm.js";

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
  const block = "0x" + (await reader.head()).number.toString(16);
  const mine = await ex.call(c).catch((e) => "ERR " + e.message);
  const theirs = await post(U, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [c, block] });
  if (mine === (theirs.result ?? "ERR " + theirs.error?.message)) same++;
}
const perCall = Math.round((performance.now() - t0) / calls.length);
check(same === calls.length, `local eth_call equals the provider's on ${same}/${calls.length} calls (${perCall} ms per call, direct)`);

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

reader.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
