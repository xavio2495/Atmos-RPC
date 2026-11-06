<!--
  BurstChart: when each of the 10 page-load reads finished, per arm, on one shared time axis.
  One row per read (in completion order), one thin bar per arm. A wallet that fires its reads
  in parallel through one stock worker gets a staircase: each read waits for its own fresh
  connection through the mixnet. Hover a bar for its value; the table below carries the same
  numbers for readers who can't use the chart.
-->
<script lang="ts">
	import type { Arm } from '#lib/data/bench.ts';

	let {
		stairs,
		labels,
		cutoffMs = Infinity
	}: { stairs: Partial<Record<Arm, number[]>>; labels: Record<Arm, string>; cutoffMs?: number } =
		$props();

	const order: Arm[] = ['D', 'N0', 'N1'];
	const color: Partial<Record<Arm, string>> = {
		D: 'var(--series-d)',
		N0: 'var(--series-n0)',
		N1: 'var(--series-n1)'
	};

	const arms = $derived(order.filter((a) => stairs[a]?.length));
	const sorted = $derived(
		Object.fromEntries(arms.map((a) => [a, [...(stairs[a] ?? [])].sort((x, y) => x - y)]))
	) as Record<Arm, number[]>;
	const rows = $derived(Math.max(...arms.map((a) => sorted[a].length)));
	const maxMs = $derived(Math.max(...arms.flatMap((a) => sorted[a])));
	const stepS = $derived(maxMs > 12000 ? 3 : maxMs > 4000 ? 1 : 0.5);
	const axisMax = $derived(Math.ceil(maxMs / 1000 / stepS) * stepS);
	const ticks = $derived(
		Array.from({ length: Math.round(axisMax / stepS) + 1 }, (_, i) => +(i * stepS).toFixed(1))
	);
	const pct = (ms: number) => (ms / 1000 / axisMax) * 100;
	const fmt = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

	let tip = $state<{ x: number; y: number; text: string } | null>(null);
	let plot: HTMLDivElement;

	function show(e: PointerEvent, arm: Arm, i: number, ms: number) {
		const box = plot.getBoundingClientRect();
		tip = {
			x: e.clientX - box.left,
			y: e.clientY - box.top,
			text: `${labels[arm]} · read ${i + 1} of ${rows} · ${ms >= cutoffMs ? `no answer by ${fmt(cutoffMs)}` : `done at ${fmt(ms)}`}`
		};
	}
</script>

<figure class="chart">
	<figcaption>
		<span class="title">Page-load burst: when each of 10 parallel reads finished</span>
		<ul class="legend">
			{#each arms as a (a)}
				<li><span class="swatch" style:background={color[a]}></span>{labels[a]}</li>
			{/each}
		</ul>
	</figcaption>

	<div class="plot" bind:this={plot} onpointerleave={() => (tip = null)} role="presentation">
		<div class="grid" aria-hidden="true">
			{#each ticks as t (t)}
				<span class="tick" style:left="{(t / axisMax) * 100}%"><i>{t}s</i></span>
			{/each}
		</div>
		{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
			<div class="row">
				<span class="idx">{i + 1}</span>
				<div class="bars">
					{#each arms as a (a)}
						{@const ms = sorted[a][i]}
						{#if ms != null}
							<div class="lane">
								<span
									class="bar"
									style:width="max({pct(ms)}%, 4px)"
									style:background={color[a]}
									onpointermove={(e) => show(e, a, i, ms)}
									role="presentation"
								></span>
								{#if i === rows - 1}
									<span class="end" style:left="max({pct(ms)}%, 4px)">{fmt(ms)}</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
		{#if tip}
			<div class="tip" style:left="{tip.x}px" style:top="{tip.y}px">{tip.text}</div>
		{/if}
	</div>

	<details class="table">
		<summary>Show as a table</summary>
		<table>
			<thead>
				<tr>
					<th>Read</th>
					{#each arms as a (a)}<th class="num">{labels[a]}</th>{/each}
				</tr>
			</thead>
			<tbody>
				{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
					<tr>
						<td>{i + 1}</td>
						{#each arms as a (a)}<td class="num"
								>{sorted[a][i] != null ? fmt(sorted[a][i]) : '–'}</td
							>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</details>
</figure>

<style>
	.chart {
		margin: 0 0 1.6em;
		padding: 18px 20px 14px;
		background: var(--surface-2);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
	}
	figcaption {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 8px 18px;
		margin-bottom: 14px;
	}
	.title {
		font: 600 0.92rem/1.3 var(--font-display);
		color: var(--ink-0);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 0;
		padding: 0;
		list-style: none;
		font: 400 0.74rem/1.4 var(--font-mono);
		color: var(--ink-1);
	}
	.swatch {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
		border-radius: 3px;
		vertical-align: -1px;
	}
	.plot {
		position: relative;
		padding: 0 56px 22px 0;
	}
	.grid {
		position: absolute;
		inset: 0 56px 0 26px;
	}
	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px solid var(--hairline);
	}
	.tick i {
		position: absolute;
		bottom: 0;
		transform: translateX(-50%);
		font: normal 400 0.66rem/1 var(--font-mono);
		color: var(--ink-2);
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0;
		padding: 3px 0;
	}
	.idx {
		width: 26px;
		flex: none;
		font: 400 0.66rem/1 var(--font-mono);
		color: var(--ink-2);
	}
	.bars {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.lane {
		position: relative;
		height: 6px;
	}
	.bar {
		position: absolute;
		left: 0;
		top: 0;
		height: 6px;
		border-radius: 0 4px 4px 0;
		cursor: crosshair;
	}
	/* a taller invisible hit area than the 6px mark */
	.bar::after {
		content: '';
		position: absolute;
		inset: -5px 0;
	}
	.end {
		position: absolute;
		top: 50%;
		transform: translate(6px, -50%);
		font: 500 0.7rem/1 var(--font-mono);
		color: var(--ink-0);
		white-space: nowrap;
	}
	.tip {
		position: absolute;
		z-index: 5;
		transform: translate(-50%, calc(-100% - 10px));
		padding: 6px 9px;
		background: var(--ink-0);
		color: var(--surface-0);
		border-radius: 6px;
		font: 400 0.72rem/1.3 var(--font-mono);
		white-space: nowrap;
		pointer-events: none;
	}
	.table summary {
		margin-top: 8px;
		cursor: pointer;
		font: 500 0.7rem/1 var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-1);
	}
	.table table {
		margin-top: 10px;
	}
</style>
