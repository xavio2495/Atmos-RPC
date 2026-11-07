<script lang="ts">
	import { onDestroy } from 'svelte';

	type Provider = {
		request(a: { method: string; params?: unknown[] }): Promise<unknown>;
		status(): {
			counts: Record<string, number>;
			ready: boolean;
			following?: { accounts: number; block: number; behind: number | null };
			error?: string;
		};
		close(): void;
		ready: Promise<void>;
	};
	type Result = { label: string; value: string; ms: number; ok: boolean };
	type Step = { key: string; label: string; done: boolean };

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
	let error = $state('');
	let pending = $state('');
	let routed = $state(false);
	let provider: Provider | null = null;
	// bumped by every start and stop, so a stopped run's late events and errors are ignored
	let generation = 0;
	let timers: ReturnType<typeof setInterval>[] = [];

	const eth = (wei: bigint) => {
		const s = wei.toString().padStart(19, '0');
		return `${s.slice(0, -18)}.${s.slice(-18, -12)} ETH`;
	};
	const pad = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

	const steps = $derived<Step[]>([
		{ key: 'route', label: 'Join the mixnet and prove a route', done: routed },
		{ key: 'checkpoint', label: 'Pick a light-client checkpoint', done: Boolean(checkpoint) },
		{ key: 'head', label: 'Verify the chain head', done: phase === 'ready' }
	]);

	async function start() {
		phase = 'booting';
		results = [];
		events = [];
		error = '';
		checkpoint = '';
		routed = false;
		elapsed = 0;
		const id = ++generation;
		const t0 = Date.now();
		timers.push(setInterval(() => (elapsed = Math.round((Date.now() - t0) / 1000)), 1000));
		const { createAtmos } = await import('atmos-rpc');
		provider = createAtmos({
			bal,
			shape,
			log: (e: Record<string, unknown>) => {
				if (id !== generation) return;
				if (e.event === 'checkpoint') checkpoint = String(e.root);
				if (e.event === 'route-accepted') routed = true;
				events = [`${Math.round((Date.now() - t0) / 1000)} s  ${e.event}`, ...events].slice(0, 30);
			}
		}) as Provider;
		try {
			await provider.ready;
			if (id !== generation) return;
			phase = 'ready';
			clearTimers();
			await refreshHead();
			timers.push(setInterval(refreshHead, 12_000));
		} catch (e) {
			// stopped by the visitor: not a failure
			if (id !== generation) return;
			clearTimers();
			phase = 'failed';
			error = String((e as Error)?.message ?? e);
			events = [`failed: ${error}`, ...events];
		}
	}

	async function refreshHead() {
		if (!provider) return;
		head = Number(await provider.request({ method: 'eth_blockNumber' }));
		status = provider.status();
	}

	async function run(
		label: string,
		method: string,
		params: unknown[],
		show: (r: string) => string
	) {
		if (!provider || pending) return;
		pending = label;
		const t = performance.now();
		try {
			const r = (await provider.request({ method, params })) as string;
			results = [
				{ label, value: show(r), ms: Math.round(performance.now() - t), ok: true },
				...results
			];
		} catch (e) {
			results = [
				{
					label,
					value: String((e as Error)?.message ?? e),
					ms: Math.round(performance.now() - t),
					ok: false
				},
				...results
			];
		}
		pending = '';
		status = provider?.status() ?? status;
	}

	function clearTimers() {
		timers.forEach(clearInterval);
		timers = [];
	}

	function stop() {
		generation++;
		clearTimers();
		provider?.close();
		provider = null;
		phase = 'idle';
		head = null;
		status = null;
		pending = '';
	}

	const validAddress = $derived(/^0x[0-9a-fA-F]{40}$/.test(address.trim()));
	const counts = $derived(
		status
			? Object.entries(status.counts)
					.filter(([, n]) => n)
					.map(([k, n]) => `${n} ${k}`)
					.join(', ')
			: ''
	);

	onDestroy(stop);
</script>

<svelte:head>
	<title>Demo · Atmos</title>
</svelte:head>

<h1>Verified Sepolia reads from this tab</h1>
<p class="lede">
	This page starts the Atmos SDK in your browser. Every RPC call leaves through the Nym mixnet from
	anon-rpc's sandboxed worker, and each answer is checked against a light-client head before it is
	shown. No Atmos server is involved.
</p>

<section class="console" aria-live="polite">
	{#if phase === 'idle' || phase === 'failed'}
		{#if phase === 'failed'}
			<p class="callout warn"><strong>Atmos did not start.</strong> {error}</p>
		{/if}
		<label class="option">
			<input type="checkbox" bind:checked={bal} />
			<span>
				<strong>Keep read accounts current from block access lists</strong> (EIP-7928)
				<small
					>After the first proof, an account is updated from each block's verified access list,
					which every client fetches alike, so reading it again names nothing to a provider. Costs
					one list per block (70–160 KB).</small
				>
			</span>
		</label>
		<label class="option">
			<input type="checkbox" bind:checked={shape} />
			<span>
				<strong>Constant-rate schedule</strong>
				<small
					>Calls leave on a fixed clock with dummies in the gaps. Slower: up to 4 s per read.</small
				>
			</span>
		</label>
		<div class="row">
			<button class="btn primary" onclick={start}
				>{phase === 'failed' ? 'Try again' : 'Start Atmos'}</button
			>
			<span class="note"
				>Takes 15 to 70 seconds. The worker downloads about 10 MB, then joins the mixnet. Only the
				Nym directory API and your entry gateway see your IP; the RPC providers see a Nym exit.</span
			>
		</div>
	{:else if phase === 'booting'}
		<div class="row head">
			<strong>Starting, {elapsed} s</strong>
			<button class="btn ghost" onclick={stop}>Stop</button>
		</div>
		<ol class="steps">
			{#each steps as s (s.key)}
				<li class:done={s.done}><span class="cell" aria-hidden="true"></span>{s.label}</li>
			{/each}
		</ol>
	{:else}
		<div class="row head">
			<span class="live"
				><span class="cell" aria-hidden="true"></span>Verified head
				<strong>{head ?? '…'}</strong></span
			>
			<button class="btn ghost" onclick={stop}>Stop</button>
		</div>
		<dl class="facts">
			<dt>Checkpoint</dt>
			<dd><code>{checkpoint ? `${checkpoint.slice(0, 18)}…` : '–'}</code></dd>
			<dt>Answers</dt>
			<dd>{counts || '–'}</dd>
			{#if status?.following}
				<dt>Access lists</dt>
				<dd>
					{status.following.accounts} accounts kept current, at block {status.following
						.block}{status.following.behind != null
						? ` (${status.following.behind} behind${status.following.behind > 2 ? ': reads use proofs until it catches up' : ''})`
						: ''}
				</dd>
			{/if}
		</dl>

		<label class="field">
			<span>Address</span>
			<input class="address" bind:value={address} spellcheck="false" aria-invalid={!validAddress} />
		</label>
		{#if !validAddress}<p class="hint">Enter a 0x address of 40 hex characters.</p>{/if}
		<div class="actions">
			<button
				class="btn"
				disabled={!!pending || !validAddress}
				onclick={() =>
					run('Balance', 'eth_getBalance', [address.trim(), 'latest'], (r) => eth(BigInt(r)))}
				>Balance</button
			>
			<button
				class="btn"
				disabled={!!pending || !validAddress}
				onclick={() =>
					run('Nonce', 'eth_getTransactionCount', [address.trim(), 'latest'], (r) =>
						String(Number(r))
					)}>Nonce</button
			>
			<button
				class="btn"
				disabled={!!pending || !validAddress}
				onclick={() =>
					run(
						'WETH balance',
						'eth_call',
						[{ to: WETH, data: '0x70a08231' + pad(address.trim()) }, 'latest'],
						(r) => eth(BigInt(r))
					)}>WETH balance</button
			>
			<button
				class="btn"
				disabled={!!pending}
				onclick={() => run('Latest block', 'eth_blockNumber', [], (r) => String(Number(r)))}
				>Latest block</button
			>
		</div>

		{#if pending || results.length}
			<table class="results">
				<thead><tr><th>Read</th><th>Answer</th><th class="num">Time</th></tr></thead>
				<tbody>
					{#if pending}
						<tr class="pending"><td>{pending}</td><td>reading through the mixnet…</td><td></td></tr>
					{/if}
					{#each results as r, i (i)}
						<tr class:failed={!r.ok}>
							<td>{r.label}</td>
							<td class="answer">{r.value}</td>
							<td class="num">{r.ms < 5 ? 'no request' : `${r.ms} ms`}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="hint">
				Balances and nonces are checked with <code>eth_getProof</code> against the verified head; the
				WETH balance runs in a local EVM on proven state. A repeat read at the same block, and the latest
				block number, are answered from what is already verified, with no request.
			</p>
		{/if}
	{/if}

	{#if events.length}
		<details class="log">
			<summary>Event log ({events.length})</summary>
			<pre>{events.join('\n')}</pre>
		</details>
	{/if}
</section>

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
	.console {
		margin: 0 0 2.4em;
		padding: 20px 22px;
		background: var(--surface-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
	}
	.option {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		margin: 0 0 14px;
		cursor: pointer;
	}
	.option input {
		margin-top: 0.3em;
		accent-color: var(--accent);
	}
	.option small {
		display: block;
		margin-top: 2px;
		color: var(--ink-1);
		font-size: 0.8rem;
		line-height: 1.5;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 16px;
	}
	.row.head {
		justify-content: space-between;
	}
	.note,
	.hint {
		flex: 1 1 18rem;
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: var(--ink-1);
	}
	.hint {
		margin-top: 10px;
	}
	.steps {
		margin: 16px 0 0;
		padding: 0;
		list-style: none;
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 8px 0;
		color: var(--ink-2);
	}
	.steps li.done {
		color: var(--ink-0);
	}
	/* one cell of the pixel mark: hollow while waiting, filled when done */
	.cell {
		flex: none;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		border: 1.5px solid currentColor;
	}
	.steps li:not(.done) .cell {
		animation: blink 1.2s steps(2) infinite;
	}
	.done .cell,
	.live .cell {
		background: var(--accent);
		border-color: var(--accent);
	}
	.live {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 18px;
		margin: 16px 0 20px;
		font-size: 0.86rem;
	}
	.facts dt {
		color: var(--ink-1);
	}
	.facts dd {
		margin: 0;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--ink-1);
	}
	.address {
		width: 100%;
		padding: 10px 12px;
		font: 400 0.86rem/1.2 var(--font-mono);
		color: var(--ink-0);
		background: var(--surface-0);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
	}
	.address[aria-invalid='true'] {
		border-color: var(--status-error);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}
	.results {
		margin-top: 18px;
	}
	.answer {
		font-variant-numeric: tabular-nums;
		word-break: break-all;
	}
	tr.pending td {
		color: var(--ink-2);
	}
	tr.failed td {
		color: var(--status-error);
	}
	.log {
		margin-top: 18px;
		font-size: 0.8rem;
	}
	.log summary {
		cursor: pointer;
		color: var(--ink-1);
	}
	.log pre {
		margin: 8px 0 0;
		max-height: 14rem;
		overflow: auto;
	}
	@media (prefers-reduced-motion: reduce) {
		.steps li:not(.done) .cell {
			animation: none;
		}
	}
</style>
