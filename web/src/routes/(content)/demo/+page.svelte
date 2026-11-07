<script lang="ts">
	import { onDestroy } from 'svelte';

	type Provider = {
		request(a: { method: string; params?: unknown[] }): Promise<unknown>;
		status(): { counts: Record<string, number>; ready: boolean; following?: { accounts: number; block: number }; error?: string };
		close(): void;
		ready: Promise<void>;
	};
	type Result = { label: string; value: string; ms: number; ok: boolean };

	const WETH = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14';

	let bal = $state(false);
	let shape = $state(false);
	let phase = $state<'idle' | 'booting' | 'ready' | 'failed'>('idle');
	let elapsed = $state(0);
	let checkpoint = $state('');
	let head = $state<number | null>(null);
	let status = $state<ReturnType<Provider['status']> | null>(null);
	let address = $state(WETH);
	let results = $state<Result[]>([]);
	let events = $state<string[]>([]);
	let provider: Provider | null = null;
	let timers: ReturnType<typeof setInterval>[] = [];

	const eth = (wei: bigint) => {
		const s = wei.toString().padStart(19, '0');
		return `${s.slice(0, -18)}.${s.slice(-18, -12)} ETH`;
	};
	const pad = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

	async function start() {
		phase = 'booting';
		results = [];
		events = [];
		const t0 = Date.now();
		timers.push(setInterval(() => (elapsed = Math.round((Date.now() - t0) / 1000)), 1000));
		const { createAtmos } = await import('atmos-rpc');
		provider = createAtmos({
			bal,
			shape,
			log: (e: Record<string, unknown>) => {
				if (e.event === 'checkpoint') checkpoint = String(e.root);
				events = [`${Math.round((Date.now() - t0) / 1000)} s  ${e.event}`, ...events].slice(0, 30);
			}
		}) as Provider;
		try {
			await provider.ready;
			phase = 'ready';
			clearInterval(timers.shift());
			await refreshHead();
			timers.push(setInterval(refreshHead, 12_000));
		} catch (e) {
			phase = 'failed';
			events = [`failed: ${String((e as Error)?.message ?? e)}`, ...events];
		}
	}

	async function refreshHead() {
		if (!provider) return;
		head = Number(await provider.request({ method: 'eth_blockNumber' }));
		status = provider.status();
	}

	async function run(label: string, method: string, params: unknown[], show: (r: string) => string) {
		if (!provider) return;
		const t = performance.now();
		try {
			const r = (await provider.request({ method, params })) as string;
			results = [{ label, value: show(r), ms: Math.round(performance.now() - t), ok: true }, ...results];
		} catch (e) {
			results = [{ label, value: String((e as Error)?.message ?? e), ms: Math.round(performance.now() - t), ok: false }, ...results];
		}
		status = provider.status();
	}

	function stop() {
		timers.forEach(clearInterval);
		timers = [];
		provider?.close();
		provider = null;
		phase = 'idle';
		head = null;
		status = null;
	}

	onDestroy(stop);
</script>

<svelte:head>
	<title>Demo · Atmos</title>
</svelte:head>

<span class="eyebrow">Demo</span>
<h1>Verified Sepolia reads from this tab, over the Nym mixnet</h1>
<p class="lede">
	This page starts the Atmos SDK in your browser. The Nym worker runs in anon-rpc's sandboxed
	harness, every RPC call leaves through the mixnet, and each answer is checked against a
	light-client head before it is shown. No Atmos server is involved.
</p>

<div class="callout">
	<p>
		<strong>Starting takes 15 to 70 seconds.</strong> The worker downloads (about 10 MB), joins the
		mixnet, finds a working route and verifies the chain head. Only the Nym directory API and your
		entry gateway see your IP; the RPC providers see a Nym exit.
	</p>
</div>

<h2>Options</h2>
<p>
	<label><input type="checkbox" bind:checked={bal} disabled={phase !== 'idle'} /> Keep read accounts
		current from block access lists (EIP-7928)</label
	><br />
	<small
		>After the first proof, an account is updated from each block's verified access list, which every
		client fetches alike, so reading it again names nothing to a provider. Costs one list per block
		(70–160 KB).</small
	>
</p>
<p>
	<label><input type="checkbox" bind:checked={shape} disabled={phase !== 'idle'} /> Constant-rate schedule</label><br />
	<small>Calls leave on a fixed clock with dummies in the gaps. Slower: up to 4 s per read.</small>
</p>

{#if phase === 'idle' || phase === 'failed'}
	<p><button class="cta primary" onclick={start}>Start Atmos</button></p>
{:else}
	<p><button class="cta ghost" onclick={stop}>Stop</button></p>
{/if}

{#if phase !== 'idle'}
	<h2>Status</h2>
	<table>
		<tbody>
			<tr><td>State</td><td>{phase === 'booting' ? `starting, ${elapsed} s` : phase}</td></tr>
			<tr><td>Checkpoint</td><td><code>{checkpoint ? `${checkpoint.slice(0, 18)}…` : '–'}</code></td></tr>
			<tr><td>Verified head</td><td>{head ?? '–'}</td></tr>
			{#if status}
				<tr><td>Answers</td><td>{Object.entries(status.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || '–'}</td></tr>
				{#if status.following}
					<tr><td>Access lists</td><td>{status.following.accounts} accounts kept current, at block {status.following.block}</td></tr>
				{/if}
			{/if}
		</tbody>
	</table>
{/if}

{#if phase === 'ready'}
	<h2>Try a read</h2>
	<p>
		<label>Address <input class="address" bind:value={address} spellcheck="false" /></label>
	</p>
	<p class="actions">
		<button onclick={() => run('Balance', 'eth_getBalance', [address, 'latest'], (r) => eth(BigInt(r)))}>Balance</button>
		<button onclick={() => run('Nonce', 'eth_getTransactionCount', [address, 'latest'], (r) => String(Number(r)))}>Nonce</button>
		<button
			onclick={() =>
				run('WETH balance (eth_call, run locally)', 'eth_call', [{ to: WETH, data: '0x70a08231' + pad(address) }, 'latest'], (r) => eth(BigInt(r)))}
			>WETH balance</button
		>
		<button onclick={() => run('Latest block', 'eth_blockNumber', [], (r) => String(Number(r)))}>Latest block</button>
	</p>
	{#if results.length}
		<table>
			<thead><tr><th>Read</th><th>Answer</th><th class="num">Time</th></tr></thead>
			<tbody>
				{#each results as r, i (i)}
					<tr class:failed={!r.ok}><td>{r.label}</td><td><code>{r.value}</code></td><td class="num">{r.ms} ms</td></tr>
				{/each}
			</tbody>
		</table>
		<p>
			<small
				>Balances and nonces are checked with <code>eth_getProof</code> against the verified head; the
				WETH balance runs in a local EVM on proven state. A read at the same block is answered from the
				proven cache.</small
			>
		</p>
	{/if}
{/if}

{#if events.length}
	<h2>What happened</h2>
	<pre class="log">{events.join('\n')}</pre>
{/if}

<h2>Use it in your app</h2>
<pre><code
		>import {'{'} createAtmos {'}'} from 'atmos-rpc';
import {'{'} createPublicClient, custom {'}'} from 'viem';
import {'{'} sepolia {'}'} from 'viem/chains';

const atmos = createAtmos({'{'} bal: true {'}'});
const client = createPublicClient({'{'} chain: sepolia, transport: custom(atmos) {'}'});
await client.getBalance({'{'} address {'}'});</code
	></pre>
<p>See the <a href="/docs/sdk/">SDK docs</a> for the options and what each one costs.</p>

<style>
	.address {
		width: 100%;
		max-width: 46ch;
		font-family: var(--font-mono, monospace);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.log {
		max-height: 16rem;
		overflow: auto;
		font-size: 0.85em;
	}
	tr.failed td {
		opacity: 0.7;
	}
</style>
