<!--
  The pitch deck: full-screen 16:9 slides on the site's tokens. Arrow keys, space, Page Up/Down,
  or a click or tap on either half move between slides; the slide number is kept in the URL hash.
  Printing gives one slide per landscape page, for a PDF.
-->
<script lang="ts">
	import HowDiagram from '#lib/components/HowDiagram.svelte';
	import CopyLine from '#lib/components/CopyLine.svelte';

	const COUNT = 14;
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
	<title>Atmos · deck</title>
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="deck" onclick={click}>
	<section class="slide title" class:on={current === 0}>
		<div class="stage">
			<p class="mark">atmos</p>
			<p class="pitch">Anonymous Ethereum RPC that is fast enough to leave on.</p>
			<p class="foot">atmos.xavio.dev · a client layer on top of anon-rpc</p>
		</div>
	</section>

	<section class="slide" class:on={current === 1}>
		<div class="stage">
			<p class="kicker">The problem</p>
			<h2>Your RPC provider knows who you are and what you hold</h2>
			<div class="two">
				<div>
					<strong>Who</strong>
					<p>Every call carries your IP address.</p>
				</div>
				<div>
					<strong>What</strong>
					<p>Every balance you check names an address, and an address is an identity.</p>
				</div>
			</div>
		</div>
	</section>

	<section class="slide" class:on={current === 2}>
		<div class="stage">
			<p class="kicker">anon-rpc today</p>
			<h2>Private, but slow where wallets need speed</h2>
			<p class="lead">
				anon-rpc routes a wallet's calls through the Nym mixnet from a sandboxed, hash-pinned
				worker. The provider sees an exit, not you. But a page load fires many reads at once, and
				each one waits for its own fresh connection through the mixnet.
			</p>
			<div class="nums">
				<div><b>14.7–22.0 s</b><span>ten parallel reads, stock anon-rpc</span></div>
				<div><b>0.19–0.60 s</b><span>the same reads over plain RPC</span></div>
			</div>
			<p class="src">Median per region, Cloud Run in 3 regions, 4 sessions each, 2026-11-06</p>
		</div>
	</section>

	<section class="slide" class:on={current === 3}>
		<div class="stage">
			<p class="kicker">Atmos</p>
			<h2>Faster, verified, private</h2>
			<div class="three">
				<div>
					<b>5.5–6.6×</b><strong>Faster</strong>
					<p>page load than stock anon-rpc; the slowest calls 3–5× faster</p>
				</div>
				<div>
					<b>7 methods</b><strong>Verified</strong>
					<p>
						proven against a light client: a lying provider causes a failure, never a wrong answer
					</p>
				</div>
				<div>
					<b>52%</b><strong>Private</strong>
					<p>
						an observer's accuracy at telling busy from idle, with opt-in shaping (chance is 50%)
					</p>
				</div>
			</div>
			<p class="src">
				Speed: Cloud Run, 3 regions, 2026-11-06. Privacy: local host sessions, outgoing requests
				only.
			</p>
		</div>
	</section>

	<section class="slide" class:on={current === 4}>
		<div class="stage">
			<p class="kicker">How it works</p>
			<h2>Same worker, same trust model, a better client</h2>
			<div class="fig"><HowDiagram kind="path" /></div>
		</div>
	</section>

	<section class="slide" class:on={current === 5}>
		<div class="stage">
			<p class="kicker">Verified</p>
			<h2>Proven, not trusted</h2>
			<div class="fig"><HowDiagram kind="verify" /></div>
			<p class="lead small">
				Balances, nonces, code and storage by <code>eth_getProof</code>; <code>eth_call</code> in a local
				EVM on proven state; receipts against the receipts root. A proof costs about 0.5–0.9 s.
			</p>
		</div>
	</section>

	<section class="slide" class:on={current === 6}>
		<div class="stage">
			<p class="kicker">Node harness</p>
			<h2>The Nym worker, without a browser</h2>
			<ul class="road">
				<li>
					<b>Forked</b>anon-rpc's Node harness, extended with the browser pieces the Nym worker
					needs (WebSocket, Blob, Worker, MessageChannel), inside a V8 isolate
				</li>
				<li>
					<b>Fixed</b>WebAssembly that never finished loading, and a WebSocket bridge that sent
					empty frames and silently broke every mixnet handshake
				</li>
				<li><b>Result</b>Ten parallel reads in 1.5–2.7 s, as fast as Chromium (2.7–3.6 s)</li>
			</ul>
			<p class="src">Same client in both; Cloud Run, 3 regions, 4 sessions each, 2026-11-06</p>
		</div>
	</section>

	<section class="slide" class:on={current === 7}>
		<div class="stage">
			<p class="kicker">Hardened</p>
			<h2>Closing what IP hiding leaves open</h2>
			<ul class="road">
				<li>
					<b>Silent boot</b>The worker hash is pinned: starting sends no RPC call from your IP, and
					a lying provider can't swap the worker
				</li>
				<li>
					<b>Confined</b>The worker can reach only the Nym directory and its entry gateway;
					everything else has to cross the mixnet
				</li>
				<li>
					<b>Local only</b>The host answers localhost and wallet extensions; websites and DNS
					rebinding are refused
				</li>
				<li>
					<b>Audited</b>Redirect checks, entropy, WebSocket floods, trusted block hashes, EVM fork
					rules: found and fixed, each with a test
				</li>
			</ul>
			<p class="src">A traced boot made 0 RPC calls; a hostile worker's direct calls were refused</p>
		</div>
	</section>

	<section class="slide" class:on={current === 8}>
		<div class="stage">
			<p class="kicker">Demo</p>
			<h2>Verified Sepolia reads, from a browser tab</h2>
			<p class="lead">
				The SDK starts in the page, joins the mixnet, verifies the chain head and answers reads with
				proofs. No Atmos server is involved.
			</p>
			<p class="big-link"><a href="/demo/">atmos.xavio.dev/demo</a></p>
			<p class="src">The first answer takes 15 to 70 seconds while the worker joins the mixnet.</p>
		</div>
	</section>

	<section class="slide" class:on={current === 9}>
		<div class="stage">
			<p class="kicker">Install</p>
			<h2>One line for MetaMask</h2>
			<div class="lines">
				<p>Run the host on your machine</p>
				<CopyLine text="curl -fsSL https://atmos.xavio.dev/install.sh | sh" />
				<p>Then add this RPC URL as a Sepolia network</p>
				<CopyLine text="http://127.0.0.1:8545/11155111" />
			</div>
			<p class="src">
				Or in your own app: the SDK's createAtmos() is an EIP-1193 provider for viem, ethers and
				wagmi.
			</p>
		</div>
	</section>

	<section class="slide" class:on={current === 10}>
		<div class="stage">
			<p class="kicker">The numbers</p>
			<h2>Ten parallel reads, per region</h2>
			<table>
				<thead>
					<tr><th>Region</th><th>Plain RPC</th><th>Stock anon-rpc</th><th>Atmos</th></tr>
				</thead>
				<tbody>
					<tr><td>europe-west1</td><td>185 ms</td><td>17.9 s</td><td>2.7 s</td></tr>
					<tr><td>us-east1</td><td>271 ms</td><td>14.7 s</td><td>2.7 s</td></tr>
					<tr><td>asia-south1</td><td>596 ms</td><td>22.0 s</td><td>3.6 s</td></tr>
				</tbody>
			</table>
			<p class="lead small">
				The cost: the first answer takes 17–71 s, against 16–33 s for stock anon-rpc, because Atmos
				proves a route, and verifies the chain head, before it answers.
			</p>
			<p class="src">
				Medians of 4 sessions each, Cloud Run, 2026-11-06 · every session at
				atmos.xavio.dev/benchmarks
			</p>
		</div>
	</section>

	<section class="slide" class:on={current === 11}>
		<div class="stage">
			<p class="kicker">Privacy, honestly</p>
			<h2>Who, when, what</h2>
			<ul class="ladder">
				<li>
					<span class="cells" aria-hidden="true"
						><em class:lit={1 <= 3}></em><em class:lit={2 <= 3}></em><em class:lit={3 <= 3}
						></em></span
					><strong>Who</strong><span>Hidden from the provider: it sees a mixnet exit.</span>
				</li>
				<li>
					<span class="cells" aria-hidden="true"
						><em class:lit={1 <= 2}></em><em class:lit={2 <= 2}></em><em class:lit={3 <= 2}
						></em></span
					><strong>When</strong><span
						>Hidden for outgoing requests with opt-in shaping. Replies are not padded.</span
					>
				</li>
				<li>
					<span class="cells" aria-hidden="true"
						><em class:lit={1 <= 1}></em><em class:lit={2 <= 1}></em><em class:lit={3 <= 1}
						></em></span
					><strong>What</strong><span
						>Not yet: providers see which accounts you query. Access-list updates hide repeat reads
						(experimental).</span
					>
				</li>
			</ul>
		</div>
	</section>

	<section class="slide" class:on={current === 12}>
		<div class="stage">
			<p class="kicker">Found upstream</p>
			<h2>What we found in anon-rpc itself</h2>
			<ul class="road">
				<li>
					<b>Security</b><span>The Node harness follows redirects past its own address policy, to
					loopback or cloud metadata</span>
				</li>
				<li>
					<b>Security</b><span><code>getRandomValues</code> above 64 KiB returns a partly zero buffer,
					silently</span>
				</li>
				<li>
					<b>Bug</b><span><code>Response.url</code> is empty when the worker omits it, which breaks
					libraries such as Helios</span>
				</li>
				<li>
					<b>Reported</b><span>A lying bootstrap RPC can choose which worker runs (told to the author
					privately)</span>
				</li>
			</ul>
			<p class="src">Each fix is tested on upstream's own code: it fails before, passes after</p>
		</div>
	</section>

	<section class="slide" class:on={current === 13}>
		<div class="stage">
			<p class="kicker">Next</p>
			<h2>Roadmap</h2>
			<ul class="road">
				<li>
					<b>Built</b>Routing, batching and failover · verified reads · the Node harness · hardening · the
					SDK and the host
				</li>
				<li><b>Built, opt-in</b>Constant-rate shaping · access-list updates (experimental)</li>
				<li><b>Next</b>Provider splitting, so no single provider sees every address</li>
				<li>
					<b>Planned</b>A Nym transport fork: warm connections per provider, safe retries, HTTP/2
				</li>
			</ul>
			<p class="src">atmos.xavio.dev · github.com/xavio2495/Atmos-RPC</p>
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

	.two,
	.three {
		display: grid;
		gap: 2.4cqw;
	}
	.two {
		grid-template-columns: 1fr 1fr;
	}
	.three {
		grid-template-columns: repeat(3, 1fr);
	}
	.two > div,
	.three > div {
		padding: 1.4em;
		border: 1px solid var(--hairline);
		border-radius: 1.6cqw;
		background: var(--surface-2);
	}
	.two strong,
	.three strong {
		display: block;
		color: var(--accent);
		font-size: 0.85em;
	}
	.two p,
	.three p {
		margin-top: 0.4em;
		color: var(--ink-1);
		font-size: 0.9em;
	}
	.three b,
	.nums b {
		display: block;
		font-size: 1.7em;
		white-space: nowrap;
		line-height: 1.1;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	.nums {
		display: flex;
		gap: 5cqw;
	}
	.nums span {
		color: var(--ink-1);
		font-size: 0.85em;
	}

	.fig {
		font-size: 1rem;
		width: 100%;
	}
	.fig :global(.how) {
		margin: 0;
	}
	.fig :global(svg) {
		width: auto;
		max-width: 100%;
		max-height: 46cqh;
		margin: 0 auto;
	}

	.big-link a {
		font-size: 1.8em;
		font-weight: 700;
		color: var(--accent);
	}
	.lines {
		display: grid;
		gap: 1.2cqh;
		max-width: 36em;
		font-size: 0.9em;
	}
	.lines p {
		color: var(--ink-1);
	}
	.lines :global(.line) {
		margin: 0;
	}
	.lines :global(.line code) {
		font-size: 1.5cqw;
	}
	.lines :global(.line button) {
		font-size: 1.1cqw;
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

	.ladder,
	.road {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.ladder li {
		display: grid;
		grid-template-columns: 4.2em 5em 1fr;
		align-items: center;
		gap: 1em;
		padding: 0.8em 0;
		border-top: 1px solid var(--hairline);
	}
	.cells {
		display: flex;
		gap: 0.25em;
	}
	.cells em {
		width: 0.8em;
		height: 0.8em;
		border-radius: 0.18em;
		border: 0.12em solid var(--accent);
	}
	.cells em.lit {
		background: var(--accent);
	}
	.ladder li > span:last-child {
		color: var(--ink-1);
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
