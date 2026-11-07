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
	type Result = { value: string; ms: number; ok: boolean };
	type Step = { key: string; label: string; done: boolean };
	type Read = {
		key: string;
		label: string;
		how: string;
		usesAddress: boolean;
		call: (a: string) => [string, unknown[]];
		show: (r: string) => string;
	};

	const WETH = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14';

	let bal = $state(false);
	let shape = $state(false);
	let phase = $state<'idle' | 'booting' | 'ready' | 'failed'>('idle');
	let elapsed = $state(0);
	let checkpoint = $state('');
	let head = $state<number | null>(null);
	let status = $state<ReturnType<Provider['status']> | null>(null);
	let address = $state(WETH);
	let results = $state<Record<string, Result>>({});
	let events = $state<string[]>([]);
	let error = $state('');
	let pending = $state<Record<string, boolean>>({});
	let routed = $state(false);
	let retry = $state('');
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
		{ key: 'route', label: 'Route through the mixnet', done: routed },
		{ key: 'checkpoint', label: 'Light-client checkpoint', done: Boolean(checkpoint) },
		{ key: 'head', label: 'Verified chain head', done: phase === 'ready' }
	]);

	const reads: Read[] = [
		{
			key: 'balance',
			label: 'Balance',
			how: 'eth_getProof',
			usesAddress: true,
			call: (a) => ['eth_getBalance', [a, 'latest']],
			show: (r) => eth(BigInt(r))
		},
		{
			key: 'nonce',
			label: 'Nonce',
			how: 'eth_getProof',
			usesAddress: true,
			call: (a) => ['eth_getTransactionCount', [a, 'latest']],
			show: (r) => String(Number(r))
		},
		{
			key: 'weth',
			label: 'WETH balance',
			how: 'eth_call in a local EVM',
			usesAddress: true,
			call: (a) => ['eth_call', [{ to: WETH, data: '0x70a08231' + pad(a) }, 'latest']],
			show: (r) => eth(BigInt(r))
		},
		{
			key: 'block',
			label: 'Latest block',
			how: 'the verified head',
			usesAddress: false,
			call: () => ['eth_blockNumber', []],
			show: (r) => Number(r).toLocaleString('en')
		}
	];

	async function start() {
		phase = 'booting';
		results = {};
		events = [];
		error = '';
		checkpoint = '';
		routed = false;
		retry = '';
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
				// the SDK keeps retrying a failed start; say so rather than look stuck
				if (e.event === 'start-failed') retry = `attempt ${Number(e.attempt) + 1} failed, retrying`;
				const why = e.reason ? `: ${e.reason}` : '';
				events = [`${Math.round((Date.now() - t0) / 1000)} s  ${e.event}${why}`, ...events].slice(
					0,
					30
				);
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

	// each read has one tile; running it again replaces the tile's answer
	async function run(read: Read) {
		if (!provider || pending[read.key]) return;
		pending[read.key] = true;
		const [method, params] = read.call(address.trim());
		const t = performance.now();
		let result: Result;
		try {
			const r = (await provider.request({ method, params })) as string;
			result = { value: read.show(r), ms: Math.round(performance.now() - t), ok: true };
		} catch (e) {
			result = {
				value: String((e as Error)?.message ?? e),
				ms: Math.round(performance.now() - t),
				ok: false
			};
		}
		pending[read.key] = false;
		if (!provider) return;
		results[read.key] = result;
		status = provider.status();
	}

	// answers for the old address no longer apply
	function changeAddress() {
		for (const r of reads) if (r.usesAddress) delete results[r.key];
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
		pending = {};
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

	const live = $derived(phase === 'ready');
	const stateLabel = $derived(
		{ idle: 'Not started', booting: 'Starting', ready: 'Connected', failed: 'Did not start' }[phase]
	);
	const stateDetail = $derived(
		phase === 'booting'
			? `${elapsed} s${retry ? ` · ${retry}` : ''}`
			: phase === 'ready'
				? `head ${head?.toLocaleString('en') ?? '…'}`
				: phase === 'failed'
					? error
					: 'takes 15 to 70 seconds'
	);
</script>

<svelte:head>
	<title>Demo · Atmos</title>
</svelte:head>

<h1>Live demo</h1>
<p class="lede">
	Atmos running in this tab. Every read crosses the Nym mixnet from anon-rpc's sandboxed worker and
	is proven against a light client before it is shown. No Atmos server is involved.
</p>

<section class="app" aria-label="Atmos demo">
	<div class="top">
		<p class="state" aria-live="polite">
			<span class="dot {phase}" aria-hidden="true"></span>
			<strong>{stateLabel}</strong>
			<span class="detail">{stateDetail}</span>
		</p>
		{#if phase === 'booting' || phase === 'ready'}
			<button class="btn" onclick={stop}>Stop</button>
		{:else}
			<button class="btn primary" onclick={start}
				>{phase === 'failed' ? 'Try again' : 'Start Atmos'}</button
			>
		{/if}
	</div>

	<div class="settings">
		{#each [{ label: 'Access-list updates', note: 'EIP-7928, experimental · repeat reads can name nothing', get: () => bal, set: (v: boolean) => (bal = v) }, { label: 'Constant-rate schedule', note: 'fixed clock with dummies · up to 4 s a read', get: () => shape, set: (v: boolean) => (shape = v) }] as o (o.label)}
			<button
				class="switch"
				role="switch"
				aria-checked={o.get()}
				disabled={phase === 'booting' || phase === 'ready'}
				onclick={() => o.set(!o.get())}
			>
				<span class="track" aria-hidden="true"><span class="knob"></span></span>
				<span class="text"><strong>{o.label}</strong><small>{o.note}</small></span>
			</button>
		{/each}
	</div>

	<ol class="steps" class:on={phase !== 'idle'}>
		{#each steps as st (st.key)}
			<li class:done={st.done} class:busy={phase === 'booting' && !st.done}>
				<span class="cell" aria-hidden="true"></span>{st.label}
			</li>
		{/each}
	</ol>

	<label class="field">
		<span>Address</span>
		<input
			class="address"
			bind:value={address}
			oninput={changeAddress}
			spellcheck="false"
			aria-invalid={!validAddress}
		/>
	</label>
	{#if !validAddress}<p class="hint warn">Enter a 0x address of 40 hex characters.</p>{/if}

	<div class="tiles">
		{#each reads as r (r.key)}
			{@const res = results[r.key]}
			<button
				class="read"
				class:failed={res && !res.ok}
				disabled={!live || pending[r.key] || (r.usesAddress && !validAddress)}
				onclick={() => run(r)}
			>
				<span class="name">{r.label}</span>
				<span class="value">{pending[r.key] ? 'reading…' : (res?.value ?? '–')}</span>
				<span class="meta"
					>{res && !pending[r.key]
						? res.ms < 5
							? 'no request · already verified'
							: `${res.ms.toLocaleString('en')} ms · ${r.how}`
						: live
							? `Read · ${r.how}`
							: r.how}</span
				>
			</button>
		{/each}
	</div>

	<dl class="facts">
		<div>
			<dt>Checkpoint</dt>
			<dd><code>{checkpoint ? `${checkpoint.slice(0, 14)}…` : '–'}</code></dd>
		</div>
		<div>
			<dt>Answers</dt>
			<dd>{counts || '–'}</dd>
		</div>
		{#if status?.following}
			<div>
				<dt>Access lists</dt>
				<dd>
					{status.following.accounts} accounts at block {status.following.block}{status.following
						.behind != null
						? `, ${status.following.behind} behind${status.following.behind > 2 ? ' (proofs until it catches up)' : ''}`
						: ''}
				</dd>
			</div>
		{/if}
	</dl>

	<details class="log">
		<summary>Event log{events.length ? ` (${events.length})` : ''}</summary>
		<pre>{events.length ? events.join('\n') : 'Nothing yet.'}</pre>
	</details>
</section>

<p class="small">
	Only the Nym directory API and your entry gateway see your IP; the RPC providers see a Nym exit.
	The worker download is about 10 MB.
</p>

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
	.app {
		margin: 0 0 1em;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		overflow: hidden;
	}
	.app > * {
		padding-left: 20px;
		padding-right: 20px;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-top: 14px;
		padding-bottom: 14px;
		border-bottom: 1px solid var(--hairline);
	}
	.state {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 10px;
		min-width: 0;
		margin: 0;
	}
	.detail {
		color: var(--ink-1);
		font-size: 0.86rem;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	.dot {
		align-self: center;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: var(--ink-2);
	}
	.dot.booting {
		background: var(--accent);
		animation: blink 1.2s steps(2) infinite;
	}
	.dot.ready {
		background: var(--accent);
	}
	.dot.failed {
		background: var(--status-error);
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}

	.settings {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: 8px 20px;
		padding-top: 16px;
	}
	.switch {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 0;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.switch:disabled {
		cursor: default;
		opacity: 0.55;
	}
	.track {
		flex: none;
		position: relative;
		width: 34px;
		height: 20px;
		margin-top: 2px;
		border-radius: 6px;
		background: var(--surface-1);
		border: 1px solid var(--hairline);
		transition: background 160ms ease;
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: var(--ink-2);
		transition:
			transform 180ms ease,
			background 160ms ease;
	}
	.switch[aria-checked='true'] .track {
		background: var(--accent-tint);
		border-color: var(--accent);
	}
	.switch[aria-checked='true'] .knob {
		transform: translateX(14px);
		background: var(--accent);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 0.88rem;
		line-height: 1.3;
	}
	.text small {
		color: var(--ink-1);
		font-size: 0.76rem;
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin: 16px 0 0;
		list-style: none;
		font-size: 0.78rem;
		color: var(--ink-2);
	}
	.steps li {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding-top: 10px;
		border-top: 2px solid var(--surface-1);
	}
	.steps li.done {
		color: var(--ink-0);
		border-top-color: var(--accent);
	}
	.cell {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 2px;
		border: 1.5px solid currentColor;
	}
	.done .cell {
		background: var(--accent);
		border-color: var(--accent);
	}
	.busy .cell {
		animation: blink 1.2s steps(2) infinite;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 20px;
		font-size: 0.78rem;
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
	.address:focus {
		outline: none;
		border-color: var(--accent);
	}
	.address[aria-invalid='true'] {
		border-color: var(--status-error);
	}
	.hint {
		margin: 6px 0 0;
		font-size: 0.76rem;
		color: var(--ink-1);
	}
	.hint.warn {
		color: var(--status-error);
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		padding-top: 14px;
	}
	.read {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		min-width: 0;
		padding: 14px 16px;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
		background: var(--surface-0);
		color: var(--ink-0);
		text-align: left;
		cursor: pointer;
		transition: border-color 160ms ease;
	}
	.read:hover:not(:disabled) {
		border-color: var(--accent);
	}
	.read:disabled {
		cursor: default;
	}
	.read:disabled .value,
	.read:disabled .name {
		opacity: 0.6;
	}
	.name {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--ink-1);
	}
	.value {
		max-width: 100%;
		font-size: 1.15rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		font-size: 0.72rem;
		color: var(--ink-2);
	}
	.read:not(:disabled) .meta {
		color: var(--accent);
	}
	.read.failed .value {
		font-size: 0.82rem;
		white-space: normal;
		color: var(--status-error);
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 24px;
		margin: 0;
		padding-top: 16px;
		font-size: 0.8rem;
	}
	.facts div {
		display: flex;
		gap: 8px;
	}
	.facts dt {
		color: var(--ink-1);
	}
	.facts dd {
		margin: 0;
	}

	.log {
		margin-top: 16px;
		padding-top: 12px;
		padding-bottom: 12px;
		border-top: 1px solid var(--hairline);
		font-size: 0.78rem;
	}
	.log summary {
		cursor: pointer;
		color: var(--ink-1);
		font-weight: 600;
	}
	.log pre {
		margin: 10px 0 0;
		height: 9rem;
		overflow: auto;
	}
	.small {
		font-size: 0.8rem;
		color: var(--ink-1);
	}

	@media (max-width: 520px) {
		.steps,
		.tiles {
			grid-template-columns: 1fr;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot.booting,
		.busy .cell {
			animation: none;
		}
	}
</style>
