import { docs } from '#lib/data/docs.ts';

export const prerender = true;

const pages = [
	['/how-it-works/', 'What anon-rpc hides, what a provider still sees, and the three Atmos stages'],
	['/compare/', 'Atmos v1 against stock anon-rpc, feature by feature, with code'],
	['/benchmarks/', 'Stock anon-rpc vs Atmos, measured from Cloud Run with headless Chromium'],
	['/demo/', 'The SDK running in the browser: verified Sepolia reads over the Nym mixnet']
];

export function GET({ url }) {
	const abs = (p: string) => new URL(p, url.origin).href;
	const body = `# Atmos

> Atmos is a client layer on top of anon-rpc (ethereum/anon-rpc). It sends Ethereum JSON-RPC through the Nym mixnet using the stock, hash-pinned Nym worker, with route selection from public data, a probe before a route is trusted, a standby route with failover and per-provider batching. Reads are checked against a light client; an optional constant-rate schedule shapes outgoing requests. Sepolia only. Use it from a wallet through a local host (install: curl -fsSL https://atmos.xavio.dev/install.sh | sh, then RPC URL http://127.0.0.1:8545/11155111), or from an app through the SDK's EIP-1193 provider.

## Docs

${docs.map((d) => `- [${d.label}](${abs(d.href)})`).join('\n')}

## Pages

${pages.map(([p, d]) => `- [${p}](${abs(p)}): ${d}`).join('\n')}

## Minimal use

\`\`\`js
import { createAtmos } from "atmos-rpc"; // the sdk/ folder of the Atmos repository; not on npm yet
import { createPublicClient, custom } from "viem";
import { sepolia } from "viem/chains";
const atmos = createAtmos();
const client = createPublicClient({ chain: sepolia, transport: custom(atmos) });
await client.getBalance({ address: "0x…" }); // proven against the verified head
\`\`\`
`;
	return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
