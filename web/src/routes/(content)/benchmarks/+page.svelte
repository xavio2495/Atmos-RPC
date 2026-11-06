<script lang="ts">
	import BurstChart from '#lib/components/BurstChart.svelte';
	import { run, regions, type Arm } from '#lib/data/bench.ts';

	const labels = Object.fromEntries(run.arms.map((a) => [a.arm, a.label])) as Record<Arm, string>;
	const ms = (v: number | null) =>
		v == null ? '–' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`;
	const ci = (c: [number, number] | null) => (c ? `${ms(c[0])} – ${ms(c[1])}` : '');
</script>

<svelte:head>
	<title>Benchmarks · Atmos</title>
</svelte:head>

<span class="eyebrow">Benchmarks</span>
<h1>Stock anon-rpc against Atmos, from the cloud</h1>
<p class="lede">
	The same wallet-shaped workload runs in each arm: plain fetch, the stock anon-rpc Nym worker,
	Atmos v1 on top of that same worker, and Atmos with a constant-rate schedule or with verified
	reads. Each session runs headless Chromium in a Cloud Run job, so no tab is ever throttled in the
	background.
</p>

{#if run.status === 'partial'}
	<div class="callout"><p><strong>Partial results.</strong> {run.note} As of {run.asOf}.</p></div>
{:else}
	<p>{run.note} Measured {run.asOf}.</p>
{/if}

<h2>Results, {run.region}</h2>
<table>
	<thead>
		<tr>
			<th>Arm</th>
			<th class="num">Sessions</th>
			<th class="num">10-read burst</th>
			<th class="num">Steady p50</th>
			<th class="num">Steady p95</th>
			<th class="num">First answer</th>
			<th class="num">Success</th>
		</tr>
	</thead>
	<tbody>
		{#each run.arms as a (a.arm)}
			<tr>
				<td>{a.label}</td>
				<td class="num">{a.sessions}</td>
				<td class="num">{ms(a.burstMs)}<br /><small>{ci(a.burstCi)}</small></td>
				<td class="num">{ms(a.steadyP50)}</td>
				<td class="num">{ms(a.steadyP95)}</td>
				<td class="num">{ms(a.firstOkMs)}</td>
				<td class="num">{a.successPct == null ? '–' : `${a.successPct}%`}</td>
			</tr>
		{/each}
	</tbody>
</table>
<p>
	Burst values are the median across sessions, with a bootstrap 95% interval underneath. Steady
	latency is per call during the polling phase. "First answer" runs from creating the worker to its
	first successful reply, boot included.
</p>

<BurstChart stairs={run.burstStairs} {labels} cutoffMs={run.cutoffMs} />
<p>
	A call with no answer after {run.cutoffMs / 1000} s is cut off. The stock worker's median session
	answered only its first two burst reads before that cut-off; the other eight are drawn at it.
</p>
<p>
	The staircase is the cost of parallel calls through one stock worker. Its transport keeps a single
	pooled connection per origin, so every extra concurrent call opens a fresh TCP and TLS connection
	through the mixnet, one after another. Atmos sends the same ten reads as one JSON-RPC batch on a
	connection that is already warm.
</p>

<h2>Three regions</h2>
<p>
	Medians per region: burst, steady p50, and share of calls answered. The verified-read arm comes
	from a separate run with four sessions per arm; the constant-rate arm pays for its fixed slots
	with a longer burst.
</p>
<table>
	<thead>
		<tr>
			<th>Region</th>
			<th class="num">Direct</th>
			<th class="num">Stock anon-rpc</th>
			<th class="num">Atmos v1</th>
			<th class="num">Constant-rate</th>
			<th class="num">Verified reads</th>
		</tr>
	</thead>
	<tbody>
		{#each regions as r (r.region)}
			<tr>
				<td>{r.region}</td>
				{#each ['D', 'N0', 'N1', 'N2S', 'N2V'] as const as k (k)}
					{@const c = r.cells[k]}
					<td class="num"
						>{#if c}{ms(c[0])}<br /><small>{ms(c[1])} · {c[2]}%</small>{:else}–{/if}</td
					>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<h2>The workload</h2>
<p>One session takes about ten minutes, on one RPC provider chosen per session:</p>
<ol>
	<li>
		<strong>Boot.</strong> Create the worker; time to <code>ready</code>, then to the first
		successful call.
	</li>
	<li>
		<strong>Page-load burst.</strong> Ten reads at once: eight <code>eth_getBalance</code>, one
		<code>eth_blockNumber</code>, one <code>eth_getTransactionCount</code>.
	</li>
	<li>
		<strong>Steady polling.</strong> <code>eth_blockNumber</code> every 12 s, and a balance refresh every
		30 s.
	</li>
	<li>
		<strong>Write.</strong> One unfunded Sepolia transaction from a fresh key. The expected answer
		is <code>insufficient funds</code>, so the write path is measured without moving value.
	</li>
</ol>

<h2>Method</h2>
<ul>
	<li>The unit is the session, not the call, since calls within a session are correlated.</li>
	<li>
		Arms are interleaved round-robin in each region, so drift over time hits every arm equally.
	</li>
	<li>
		The direct arm is each region's own floor. Latency added by the anonymity network is reported
		against it, within the same region.
	</li>
	<li>Only keyless public RPCs are used, at a few requests per second per provider at most.</li>
</ul>

<h2>Earlier measurements</h2>
<p>
	Before this benchmark, the same effect was measured in a desktop browser with live Nym workers.
	Those runs used a home connection and few samples, so read them as direction, not as final
	figures.
</p>
<table>
	<thead>
		<tr><th>Pattern, 10 reads on one worker</th><th class="num">Wall time (3 rounds)</th></tr>
	</thead>
	<tbody>
		<tr
			><td>10 concurrent calls (how wallets issue them)</td><td class="num">8.5 / 9.1 / 9.9 s</td
			></tr
		>
		<tr><td>10 sequential calls</td><td class="num">6.7 / 6.8 / 7.0 s</td></tr>
		<tr><td>One JSON-RPC batch</td><td class="num">1.06 / 1.20 / 1.45 s</td></tr>
		<tr><td>Two 5-read batches on two workers</td><td class="num">0.83 / 0.89 / 0.99 s</td></tr>
	</tbody>
</table>

<style>
	small {
		color: var(--ink-2);
		font-size: 0.72rem;
	}
</style>
