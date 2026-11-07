<!--
  The finalist pitch: full-screen 16:9 slides on the site's tokens. Arrow keys, space, Page Up/Down,
  or a click or tap on either half move between slides; the slide number is kept in the URL hash.
  Printing gives one slide per landscape page, for a PDF.
-->
<script lang="ts">
	import HowDiagram from '#lib/components/HowDiagram.svelte';
	import CopyLine from '#lib/components/CopyLine.svelte';

	const COUNT = 10;
	let current = $state(0);

	function go(n: number) {
		current = Math.max(0, Math.min(COUNT - 1, n));
		history.replaceState(history.state, '', `#${current + 1}`);
	}

	// follow the slide number in the URL, on load and when it is edited
	$effect(() => {
		const read = () => {
			const n = Number(location.hash.slice(1));
			if (n >= 1 && n <= COUNT) current = n - 1;
		};
		read();
		addEventListener('hashchange', read);
		return () => removeEventListener('hashchange', read);
	});

	function key(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement) return;
		if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) go(current + 1);
		else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) go(current - 1);
		else if (e.key === 'Home') go(0);
		else if (e.key === 'End') go(COUNT - 1);
		else return;
		e.preventDefault();
	}

	// a click or tap on the right half goes forward, on the left half back; links and buttons work as usual
	function click(e: MouseEvent) {
		if ((e.target as HTMLElement).closest('a, button, input, code')) return;
		go(current + (e.clientX > innerWidth / 2 ? 1 : -1));
	}
</script>

<svelte:window onkeydown={key} />
<svelte:head>
	<title>Atmos · pitch</title>
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="deck" onclick={click}>
	<section class="slide title" class:on={current === 0}>
		<div class="stage">
			<p class="mark">atmos</p>
			<p class="pitch">Private, verified Ethereum RPC that is fast enough to leave on.</p>
			<p class="foot">ETHGlobal Mumbai · atmos.xavio.dev</p>
		</div>
	</section>

	<section class="slide" class:on={current === 1}>
		<div class="stage">
			<p class="kicker">The problem</p>
			<h2>Every RPC call tells a stranger about you</h2>
			<ul class="road">
				<li><b>Who</b><span>Every call carries your IP address.</span></li>
				<li><b>What</b><span>Every balance you check names an address, and an address is an identity.</span></li>
				<li><b>When</b><span>Your traffic shows exactly when you are active.</span></li>
				<li><b>Trust</b><span>The wallet believes whatever comes back. The provider can answer falsely.</span></li>
			</ul>
			<p class="src">Most wallets send all of this to a handful of RPC providers by default.</p>
		</div>
	</section>

	<section class="slide" class:on={current === 2}>
		<div class="stage">
			<p class="kicker">anon-rpc</p>
			<h2>The Ethereum Foundation's answer: hide the IP</h2>
			<p class="lead">
				The wallet runs a sandboxed, hash-pinned worker that sends its RPC calls through an
				anonymity network such as Nym. The provider sees the network's exit, not you. Any network can
				plug in behind one standard.
			</p>
			<p class="src">ethereum/anon-rpc · spec 0.4.0 · worker used here: Nym 0.1.0</p>
		</div>
	</section>

	<section class="slide" class:on={current === 3}>
		<div class="stage">
			<p class="kicker">anon-rpc today</p>
			<h2>Private, but not ready to leave on</h2>
			<ul class="road">
				<li><b>Slow</b><span>Ten parallel reads take 14.7–22.0 s, against 0.19–0.60 s over plain RPC.</span></li>
				<li><b>Fragile</b><span>A worker can report ready on a route that is already dead.</span></li>
				<li><b>Trusting</b><span>Nothing checks the answers: the provider or the exit can lie.</span></li>
				<li>
					<b>Leaky edges</b><span>Booting asks an RPC provider from your own IP, and a lying one can choose
					the worker. We also found harness bugs: redirects past its own address policy, partly zero
					random bytes, an empty <code>Response.url</code>.</span>
				</li>
			</ul>
			<p class="src">Speed: medians per region, Cloud Run in 3 regions, 4 sessions each, 2026-11-06</p>
		</div>
	</section>

	<section class="slide" class:on={current === 4}>
		<div class="stage">
			<p class="kicker">Atmos RPC</p>
			<h2>Same worker, a better client</h2>
			<table>
				<thead><tr><th>anon-rpc today</th><th>What Atmos does</th></tr></thead>
				<tbody>
					<tr><td>Slow, fragile</td><td>Probes a route before trusting it, keeps a warm standby, batches calls</td></tr>
					<tr><td>Trusting</td><td>A light client, Merkle proofs and a local EVM check every answer it can</td></tr>
					<tr><td>Leaky edges</td><td>Pinned worker, a confined sandbox, a local-only host, harness fixes</td></tr>
					<tr><td>Visible timing</td><td>Optional constant-rate schedule with dummy calls</td></tr>
					<tr><td>Hard to use</td><td>One-line install for MetaMask; an EIP-1193 SDK for apps</td></tr>
				</tbody>
			</table>
			<p class="src">No change to the Nym worker or to the anon-rpc standard. Routes also rotate every ~10 minutes.</p>
		</div>
	</section>

	<section class="slide" class:on={current === 5}>
		<div class="stage">
			<p class="kicker">Faster</p>
			<h2>Ten parallel reads, per region</h2>
			<table>
				<thead><tr><th>Region</th><th>Plain RPC</th><th>Stock anon-rpc</th><th>Atmos</th></tr></thead>
				<tbody>
					<tr><td>europe-west1</td><td>185 ms</td><td>17.9 s</td><td>2.7 s</td></tr>
					<tr><td>us-east1</td><td>271 ms</td><td>14.7 s</td><td>2.7 s</td></tr>
					<tr><td>asia-south1</td><td>596 ms</td><td>22.0 s</td><td>3.6 s</td></tr>
				</tbody>
			</table>
			<p class="lead small">
				Page loads 5.5–6.6× faster, the slowest calls 3–5× faster. The cost: the first answer takes
				17–71 s, against 16–33 s, because Atmos proves a route and the chain head first.
			</p>
			<p class="src">Medians of 4 sessions each, Cloud Run, 2026-11-06</p>
		</div>
	</section>

	<section class="slide" class:on={current === 6}>
		<div class="stage">
			<p class="kicker">Verified and hardened</p>
			<h2>Proven, not trusted</h2>
			<div class="two">
				<div>
					<strong>Verified</strong>
					<p>
						Balances, nonces, code and storage are proven against a light-client head; eth_call runs in
						a local EVM on proven state; receipts are checked. A lie causes a failure, never a wrong
						answer.
					</p>
				</div>
				<div>
					<strong>Hardened</strong>
					<p>
						Booting sends no RPC call from your IP. The worker can reach only the mixnet. The host
						refuses websites. An observer guessing when you are active is at chance with shaping on.
					</p>
				</div>
			</div>
			<p class="src">Shaping result: local host sessions, outgoing requests only (52% vs 98.6%; chance is 50%)</p>
		</div>
	</section>

	<section class="slide title" class:on={current === 7}>
		<div class="stage">
			<p class="demo-word">Demo</p>
		</div>
	</section>

	<section class="slide" class:on={current === 8}>
		<div class="stage">
			<p class="kicker">Trade-offs</p>
			<h2>An upgrade to anon-rpc, not true anonymity</h2>
			<ul class="road">
				<li>
					<b>The model</b><span>Atmos keeps anon-rpc's model: it hides who you are, not what you ask. A
					new privacy model would need a new standard.</span>
				</li>
				<li>
					<b>What you read</b><span>Proofs still name your addresses to a provider. An experimental mode
					hides repeat reads.</span>
				</li>
				<li>
					<b>Timing</b><span>Replies are not padded, and a transaction can be linked to the reads just before
					it.</span>
				</li>
				<li>
					<b>Trust</b><span>The entry gateway sees your IP, the mixing is Nym's, and the first answer is slower.
					Sepolia only, unaudited.</span>
				</li>
			</ul>
			<p class="src">Next: hide what you ask, through private retrieval of Ethereum state.</p>
		</div>
	</section>

	<section class="slide title" class:on={current === 9}>
		<div class="stage">
			<p class="mark">atmos</p>
			<p class="pitch">Faster. Verified. More private.</p>
			<p class="foot">atmos.xavio.dev · github.com/xavio2495/Atmos-RPC</p>
		</div>
	</section>
</div>

<nav class="controls" aria-label="Slides">
	<button onclick={() => go(current - 1)} disabled={current === 0} aria-label="Previous slide"
		>←</button
	>
	<span>{current + 1} / {COUNT}</span>
	<button onclick={() => go(current + 1)} disabled={current === COUNT - 1} aria-label="Next slide"
		>→</button
	>
</nav>

<style>
	.demo-word {
		margin: 0;
		font-weight: 800;
		font-size: clamp(6rem, 18vw, 16rem);
		letter-spacing: -0.03em;
		color: var(--accent);
	}

	.deck {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--paper);
	}
	.slide {
		display: none;
		width: min(100vw, calc(100vh * 16 / 9));
		aspect-ratio: 16 / 9;
		container-type: size;
		background: var(--surface-0);
	}
	.slide.on {
		display: block;
	}
	.stage {
		height: 100%;
		padding: 6cqh 7cqw;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 2.4cqh;
		font-size: 2.1cqw;
		line-height: 1.45;
		color: var(--ink-0);
	}
	.kicker {
		margin: 0;
		font-size: 0.8em;
		font-weight: 700;
		color: var(--accent);
	}
	h2 {
		margin: 0;
		font-size: 2.1em;
		line-height: 1.15;
		font-weight: 700;
		letter-spacing: -0.02em;
		max-width: 22em;
	}
	p {
		margin: 0;
	}
	.lead {
		max-width: 34em;
		color: var(--ink-1);
	}
	.small {
		font-size: 0.85em;
	}
	.src {
		margin-top: auto;
		font-size: 0.62em;
		color: var(--ink-2);
	}
	code {
		font: 400 0.9em var(--font-mono);
	}

	.title .stage {
		align-items: center;
		text-align: center;
	}
	.mark {
		font: 400 4.6em/1 var(--font-title);
		letter-spacing: 0.04em;
	}
	.pitch {
		font-size: 1.3em;
		color: var(--ink-1);
	}
	.title .foot {
		position: absolute;
		bottom: 6cqh;
		font-size: 0.7em;
		color: var(--ink-2);
	}
	.title .stage {
		position: relative;
	}

	.two {
		display: grid;
		gap: 2.4cqw;
	}
	.two {
		grid-template-columns: 1fr 1fr;
	}

	.two > div {
		padding: 1.4em;
		border: 1px solid var(--hairline);
		border-radius: 1.6cqw;
		background: var(--surface-2);
	}
	.two strong {
		display: block;
		color: var(--accent);
		font-size: 0.85em;
	}
	.two p {
		margin-top: 0.4em;
		color: var(--ink-1);
		font-size: 0.9em;
	}

	table {
		border-collapse: collapse;
		font-size: 0.95em;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.5em 2em 0.5em 0;
		border-bottom: 1px solid var(--hairline);
		text-align: left;
	}
	th {
		font-size: 0.75em;
		color: var(--ink-1);
	}
	td:last-child {
		font-weight: 700;
		color: var(--accent);
	}

	.road {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.road li {
		display: grid;
		grid-template-columns: 7em 1fr;
		gap: 1em;
		padding: 0.7em 0;
		border-top: 1px solid var(--hairline);
	}
	.road b {
		color: var(--accent);
	}

	.controls {
		position: fixed;
		right: 16px;
		bottom: 14px;
		display: flex;
		align-items: center;
		gap: 10px;
		font: 600 0.8rem/1 var(--font-body);
		color: var(--ink-1);
	}
	.controls button {
		width: 30px;
		height: 30px;
		border: 1px solid var(--hairline);
		border-radius: 8px;
		background: var(--surface-0);
		color: var(--ink-0);
		cursor: pointer;
	}
	.controls button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	@media print {
		@page {
			size: 16in 9in;
			margin: 0;
		}
		:global(html),
		:global(body) {
			height: auto;
			overflow: visible;
		}
		.deck {
			position: static;
			display: block;
		}
		.slide,
		.slide.on {
			display: block;
			width: 16in;
			height: 9in;
			break-after: page;
		}
		.slide:last-child {
			break-after: auto;
		}
		.controls {
			display: none;
		}
	}
</style>
