import { docs } from '#lib/data/docs.ts';

export const prerender = true;

const pages = [
	['/how-it-works/', 'What anon-rpc hides, what a provider still sees, and the three Atmos stages'],
	['/compare/', 'Atmos v1 against stock anon-rpc, feature by feature, with code'],
	['/benchmarks/', 'Stock anon-rpc vs Atmos, measured from Cloud Run with headless Chromium']
];

export function GET({ url }) {
	const abs = (p: string) => new URL(p, url.origin).href;
	const body = `# Atmos

> Atmos is a browser client layer on top of anon-rpc (ethereum/anon-rpc). It sends Ethereum JSON-RPC through the Nym mixnet using the stock, hash-pinned Nym worker, and adds route selection from public data, a probe before a route is trusted, a standby route with failover, and per-provider JSON-RPC batching. v1 does not verify answers or shape traffic.

## Docs

${docs.map((d) => `- [${d.label}](${abs(d.href)})`).join('\n')}

## Pages

${pages.map(([p, d]) => `- [${p}](${abs(p)}): ${d}`).join('\n')}

## Minimal use

\`\`\`js
import { createAtmosClient } from "./atmos.js";
const atmos = await createAtmosClient({ bootstrapProvider, probeUrl: "https://rpc.mevblocker.io" });
const reply = await atmos.request("https://rpc.mevblocker.io", { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] });
\`\`\`
`;
	return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
