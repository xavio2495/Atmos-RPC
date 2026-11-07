<!--
  BenchCards: the three headline results at the top of the benchmarks page (faster, verified,
  private). Each card gives its number, the baseline beside it, how far it is from a truly
  anonymous RPC, what it was measured on, and a link down to the detail. The speed card plots every
  session as a dot (4 per region), so the spread is visible and nothing looks more precise than n.
-->
<script lang="ts">
	import data from '../../../static/data/atmos-final-sessions.json';

	type Session = (typeof data.sessions)[number];

	// 10-read burst per session: plain RPC, stock anon-rpc, Atmos v1 (browser harness)
	const rows = [
		{ arm: 'D', label: 'Plain RPC', colour: 'var(--series-d)' },
		{ arm: 'N0', label: 'Stock anon-rpc', colour: 'var(--series-n0)' },
		{ arm: 'N1', label: 'Atmos', colour: 'var(--series-n1)' }
	].map((r) => ({
		...r,
		sessions: data.sessions.filter((s: Session) => s.arm === r.arm)
	}));
	const regionIndex = Object.fromEntries(Object.keys(data.executions).map((r, i) => [r, i]));

	const MIN = 100;
	const MAX = 30_000;
	const x = (ms: number) => (Math.log10(ms / MIN) / Math.log10(MAX / MIN)) * 100;
	const ticks = [100, 300, 1000, 3000, 10_000, 30_000];
	const tick = (ms: number) => `${ms / 1000} s`;
	const cutOff = (s: Session) => s.burst_ok < s.burst_of;

	const proven = [
		'eth_blockNumber',
		'eth_getBalance',
		'eth_getTransactionCount',
		'eth_getCode',
		'eth_getStorageAt',
		'eth_call',
		'eth_getTransactionReceipt'
	];
	// checked, but not a proof: a constant answered locally, and a hash that must match
	const checked = ['eth_chainId', 'eth_sendRawTransaction'];
	const partly = ['eth_estimateGas', 'eth_getBlockByNumber', 'eth_getBlockByHash'];

	const privacy = [
		{
			what: 'Who',
			level: 3,
			state: 'Hidden from the provider',
			note: 'It sees a Nym exit, not your IP. Only the Nym directory and your entry gateway see it.'
		},
		{
			what: 'When',
			level: 2,
			state: 'Hidden only with shaping, which is opt-in',
			note: 'Off by default; turn it on with shape: true or ATMOS_SHAPE=1. Outgoing requests then leave on a fixed clock. Replies are not padded.'
		},
		{
			what: 'What',
			level: 1,
			state: 'Not yet',
			note: 'Providers still see which accounts you query. The access-list mode (experimental) hides repeat reads while it keeps pace.'
		}
	];
</script>

<div class="cards">
	<article class="card">
		<header>
			<h3>Faster</h3>
			<a href="#faster">Speed details ↓</a>
		</header>
		<p class="big"><strong>5.5–6.6×</strong> faster page load than stock anon-rpc</p>
		<p class="base">
			Ten parallel reads, median per region: Atmos <b>2.7–3.6 s</b>, stock anon-rpc
			<b>14.7–22.0 s</b>, plain RPC <b>0.19–0.60 s</b>.
		</p>

		<figure class="strip" aria-label="Ten-read burst time per session, log scale">
			{#each rows as r (r.arm)}
				<div class="lane">
					<span class="who">{r.label}</span>
					<span class="track">
						{#each r.sessions as s, i (i)}
							<i
								class:cut={cutOff(s)}
								style:left="{x(Math.min(s.burst_ms, MAX))}%"
								style:top="{6 + regionIndex[s.region] * 5}px"
								style:--c={r.colour}
								title="{s.region}: {(s.burst_ms / 1000).toFixed(2)} s{cutOff(s) ? ', cut off' : ''}"
							></i>
						{/each}
					</span>
				</div>
			{/each}
			<div class="axis">
				<span class="who"></span>
				<span class="track">
					{#each ticks as t (t)}<b
							class:minor={String(t)[0] === '3' && t < 10_000}
							style:left="{x(t)}%">{tick(t)}</b
						>{/each}
					<em style:left="{x(data.call_cutoff_ms)}%">24 s cut-off</em>
				</span>
			</div>
			<figcaption>
				Each square is one session (4 per region, 3 regions). A hollow square is a session whose
				burst hit the 24 s cut-off, so stock's real time is longer.
			</figcaption>
		</figure>

		<ul class="gap">
			<li>Against plain RPC, a call costs about 0.5–0.6 s more: the mixnet round trip.</li>
			<li>The slowest 5% of steady calls are 3–5× faster than stock.</li>
			<li>A single typical call is only 1.2–1.7× faster; the gain is in parallel reads.</li>
		</ul>
		<p class="qual">
			10-read burst, Atmos v1 in the browser harness · Cloud Run, 3 regions × 4 sessions ·
			2026-11-06 · bench:v9 (94f519b)
		</p>
	</article>

	<article class="card">
		<header>
			<h3>Verified</h3>
			<a href="#verified">Verification details ↓</a>
		</header>
		<p class="big">
			<strong>{proven.length} methods</strong> proven against a light client; stock anon-rpc proves none
		</p>
		<p class="base">
			For a proven method, a lying provider or exit can cause a failure, never a wrong answer.
		</p>
		<ul class="methods" aria-label="Methods by how they are checked">
			{#each proven as m (m)}<li class="full"><code>{m}</code></li>{/each}
			{#each checked as m (m)}<li class="check"><code>{m}</code></li>{/each}
			{#each partly as m (m)}<li class="half"><code>{m}</code></li>{/each}
			<li class="none"><code>everything else</code></li>
		</ul>
		<p class="legend">
			<span class="full"></span>proven <span class="check"></span>checked, not proven: a local
			constant, and a transaction hash that must match <span class="half"></span>partly: the gas
			figure and a block's transaction list are the provider's <span class="none"></span>sent
			plainly, and counted
		</p>
		<ul class="gap">
			<li>A verified balance costs about 0.5–0.9 s more than an unverified one.</li>
			<li>The latest block number takes 0 ms: it is answered from the verified head.</li>
		</ul>
		<p class="qual">
			The SDK and the host · Sepolia sync-committee light client · in the benchmark, eth_call,
			eth_estimateGas and receipts passed through unchecked
		</p>
	</article>

	<article class="card">
		<header>
			<h3>Private</h3>
			<a href="#private">Privacy details ↓</a>
		</header>
		<p class="big">
			<strong>52%</strong> chance is 50%: an observer of outgoing requests can't tell busy from idle
		</p>
		<p class="base">
			With shaping on, from the request count. From bytes it was 60%, not significant.
		</p>
		<div class="gauge" aria-label="Observer accuracy from outgoing request counts">
			<span class="bar">
				<em style:left="50%">chance</em>
				<i class="on" style:left="52.1%" title="Shaping on: 52.1%"></i>
				<i class="off" style:left="98.6%" title="Shaping off: 98.6%"></i>
			</span>
			<span class="ends"><b>0%</b><b>50%, chance</b><b>100%</b></span>
			<span class="keys"
				><span><i class="on"></i>shaped: 52.1%</span><span
					><i class="off"></i>not shaped: 98.6%</span
				><span>by request count</span></span
			>
		</div>
		<ul class="meter">
			{#each privacy as p (p.what)}
				<li>
					<span class="what">{p.what}</span>
					<span class="cells" aria-hidden="true"
						>{#each [1, 2, 3] as c (c)}<i class:lit={c <= p.level}></i>{/each}</span
					>
					<span class="state"><strong>{p.state}</strong>{p.note}</span>
				</li>
			{/each}
		</ul>
		<p class="qual">
			atmos-host, local sessions (2–4 hosts), 12 s windows, best single-threshold observer ·
			outgoing requests only, replies not measured · not the cloud run
		</p>
	</article>
</div>

<p class="weak">
	<strong>The first answer is slower.</strong> Atmos took 17–71 s to its first answer across setups
	and regions, against 16–33 s for stock anon-rpc. <a href="#first-answer">Why</a>
</p>

<style>
	.cards {
		display: grid;
		gap: 14px;
		margin: 0 0 1.2em;
	}
	.card {
		padding: 18px 20px;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}
	header h3 {
		margin: 0;
		font-size: 0.8rem;
		color: var(--accent);
	}
	header a {
		font-size: 0.78rem;
		font-weight: 600;
		border: none;
	}
	.big {
		margin: 8px 0 6px;
		font-size: 0.95rem;
		color: var(--ink-1);
	}
	.big strong {
		display: block;
		font-size: 2.2rem;
		line-height: 1.1;
		font-weight: 700;
		color: var(--ink-0);
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.base {
		margin: 0 0 14px;
		font-size: 0.86rem;
	}
	.base b {
		font-weight: 600;
		white-space: nowrap;
	}
	.qual {
		margin: 12px 0 0;
		padding-top: 10px;
		border-top: 1px solid var(--hairline);
		font-size: 0.72rem;
		color: var(--ink-2);
	}
	.gap {
		margin: 12px 0 0;
		padding-left: 1.1em;
		font-size: 0.84rem;
	}
	.gap li {
		margin: 2px 0;
	}

	/* speed: one square per session on a log axis */
	.strip {
		margin: 0;
	}
	.lane,
	.axis {
		display: grid;
		grid-template-columns: 7.5rem 1fr;
		align-items: center;
	}
	.who {
		font-size: 0.76rem;
		font-weight: 600;
		color: var(--ink-1);
	}
	.track {
		position: relative;
		height: 26px;
		border-bottom: 1px solid var(--hairline);
	}
	.lane .track i {
		position: absolute;
		width: 8px;
		height: 8px;
		margin-left: -4px;
		border-radius: 2px;
		background: var(--c);
		opacity: 0.9;
	}
	.lane .track i.cut {
		background: transparent;
		border: 1.5px solid var(--c);
	}
	.axis .track {
		height: 30px;
		border: none;
	}
	.axis b,
	.axis em {
		position: absolute;
		top: 6px;
		transform: translateX(-50%);
		font-size: 0.68rem;
		font-weight: 500;
		font-style: normal;
		color: var(--ink-2);
		white-space: nowrap;
	}
	.axis em {
		top: 18px;
		color: var(--ink-1);
	}
	figcaption {
		margin-top: 4px;
		font-size: 0.74rem;
		color: var(--ink-2);
	}

	/* verified: each method as a cell */
	.methods {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.methods li {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		padding: 4px 8px;
		border: 1px solid var(--hairline);
		border-radius: 6px;
	}
	.methods code {
		background: none;
		padding: 0;
		font-size: 0.74rem;
	}
	.methods li::before,
	.legend span {
		content: '';
		display: inline-block;
		width: 9px;
		height: 9px;
		border-radius: 2px;
		border: 1.5px solid var(--accent);
	}
	.full::before,
	.legend .full {
		background: var(--accent);
	}
	.check::before,
	.legend .check {
		background: var(--accent-tint);
		border-style: dashed;
	}
	.half::before,
	.legend .half {
		background: var(--accent-soft);
	}
	.none::before,
	.legend .none {
		border-color: var(--ink-2);
	}
	.legend {
		margin: 8px 0 0;
		font-size: 0.74rem;
		color: var(--ink-1);
	}
	.legend span {
		margin: 0 5px 0 10px;
		vertical-align: -1px;
	}
	.legend span:first-child {
		margin-left: 0;
	}

	/* private: accuracy against chance, then who / when / what */
	.gauge {
		display: grid;
		gap: 4px;
		margin: 6px 0 16px;
	}
	.bar {
		position: relative;
		height: 12px;
		border-radius: 3px;
		background: var(--surface-1);
	}
	.bar em {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 0;
		border-left: 1.5px dashed var(--ink-1);
		font-size: 0;
	}
	.gauge i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.bar i {
		position: absolute;
		top: 1px;
		margin-left: -5px;
	}
	.gauge .on {
		background: var(--series-n1);
	}
	.gauge .off {
		background: var(--ink-1);
	}
	.ends {
		display: flex;
		justify-content: space-between;
		font-size: 0.68rem;
		color: var(--ink-2);
	}
	.ends b {
		font-weight: 500;
	}
	.keys {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		font-size: 0.74rem;
		color: var(--ink-1);
	}
	.keys i {
		margin-right: 6px;
		vertical-align: -1px;
	}
	.meter {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.meter li {
		display: grid;
		grid-template-columns: 3.4rem auto 1fr;
		gap: 12px;
		align-items: start;
		margin: 0;
		padding: 9px 0;
		border-top: 1px solid var(--hairline);
		font-size: 0.82rem;
	}
	.what {
		font-weight: 700;
	}
	.cells {
		display: flex;
		gap: 3px;
		padding-top: 4px;
	}
	.cells i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		border: 1.5px solid var(--accent);
	}
	.cells i.lit {
		background: var(--accent);
	}
	.state {
		display: flex;
		flex-direction: column;
		color: var(--ink-1);
	}
	.state strong {
		color: var(--ink-0);
		font-weight: 600;
	}

	.weak {
		margin: 0 0 2em;
		padding: 12px 16px;
		border-radius: var(--radius-sm);
		background: var(--surface-1);
		font-size: 0.88rem;
	}

	@media (max-width: 520px) {
		.lane,
		.axis {
			grid-template-columns: 5.6rem 1fr;
		}
		.meter li {
			grid-template-columns: 3rem 1fr;
		}
		.axis b.minor {
			display: none;
		}
		.meter .state {
			grid-column: 1 / -1;
		}
	}
</style>
