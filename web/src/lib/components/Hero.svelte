<!--
  Hero: the persistent left tile. The wordmark, one line of pitch, two doors (docs for
  builders, benchmarks for the sceptical), and the morph card. The card is the one place the
  full morph runs: an amorphous blob (a request scattered across the mixnet) that settles into
  a structured answer when the visitor points at it, and loosens again when they leave.
-->
<script lang="ts">
	import { boot } from '#lib/motion/boot.svelte.ts';
	import { createMorph, blobRadius } from '#lib/motion/morph.ts';

	let { open = false }: { open?: boolean } = $props();

	const morph = createMorph(0);
	let hovering = $state(false);

	// Resolves once as the preloader lifts, so first-time visitors see the settle; after that it
	// follows the pointer.
	let intro = $state(false);
	$effect(() => {
		if (!boot.ready) return;
		intro = true;
		const t = setTimeout(() => (intro = false), 2600);
		return () => clearTimeout(t);
	});
	$effect(() => {
		morph.target = intro || hovering ? 1 : 0.12;
	});

	const r = $derived(morph.current);

	const rows = [
		['method', 'eth_getBalance'],
		['route', 'entry → 3 mix layers → exit'],
		['batched', 'with 9 other reads'],
		['standby', 'second route warm']
	];
</script>

<div class="hero" class:open>
	<div class="block">
		<h1 class="mark">atmos</h1>
		<p class="tag">Anonymous Ethereum RPC that is fast enough to leave on.</p>

		<div class="ctas">
			<a class="cta primary" href="/docs/">Read the docs <span aria-hidden="true">→</span></a>
			<a class="cta ghost" href="/benchmarks/">See the benchmark</a>
		</div>

		<div
			class="card"
			role="img"
			aria-label="A request leaving through the mixnet and coming back as one answer"
			style:border-radius={blobRadius(r)}
			style:--r={r}
			onpointerenter={() => (hovering = true)}
			onpointerleave={() => (hovering = false)}
		>
			{#each rows as [k, v], i (k)}
				<div class="row" style:--i={i}>
					<span class="k">{k}</span><span class="v">{v}</span>
				</div>
			{/each}
		</div>
	</div>

	<nav class="essentials" aria-label="More">
		<a href="/compare/">vs anon-rpc</a>
		<a href="/how-it-works/">How it works</a>
		<a href="/llms.txt" data-sveltekit-reload>llms.txt</a>
		<a href="https://ethereum.github.io/anon-rpc/" rel="external">anon-rpc spec</a>
	</nav>
</div>

<style>
	.hero {
		position: relative;
		z-index: 1;
		height: 100%;
		display: grid;
		place-items: center;
		padding: clamp(24px, 4vw, 56px);
	}
	.block {
		width: min(90%, 560px);
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.mark {
		margin: 0;
		font: 640 clamp(4.2rem, 11vw, 8.6rem) / 0.86 var(--font-display);
		letter-spacing: -0.06em;
		color: var(--ink-0);
	}
	.tag {
		margin: clamp(18px, 2.6vw, 28px) 0 0;
		max-width: 26rem;
		font: 400 clamp(1.02rem, 1.6vw, 1.3rem) / 1.4 var(--font-body);
		color: var(--ink-1);
	}

	.ctas {
		margin-top: clamp(22px, 3vw, 32px);
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 10px;
	}
	.cta {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		padding: 13px 22px;
		border-radius: 999px;
		font: 500 0.72rem/1 var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.12em;
		transition:
			background 180ms ease,
			border-color 180ms ease;
	}
	.cta.primary {
		background: var(--accent);
		color: var(--surface-0);
		border: 1px solid var(--accent);
	}
	.cta.primary:hover {
		background: var(--accent-deep);
		border-color: var(--accent-deep);
	}
	.cta.primary span {
		transition: transform 220ms ease;
	}
	.cta.primary:hover span {
		transform: translateX(4px);
	}
	.cta.ghost {
		border: 1px solid var(--hairline);
		background: color-mix(in srgb, var(--surface-0) 45%, transparent);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
	}
	.cta.ghost:hover {
		background: color-mix(in srgb, var(--surface-0) 75%, transparent);
	}

	.card {
		margin-top: clamp(28px, 4vw, 44px);
		width: min(100%, 380px);
		padding: 18px 22px;
		text-align: left;
		background: color-mix(in srgb, var(--surface-0) 70%, transparent);
		border: 1px solid var(--hairline);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		cursor: default;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 5px 0;
		font: 400 0.76rem/1.4 var(--font-mono);
		/* rows drift apart and blur while the card is a blob, and settle into line as it resolves */
		opacity: calc(0.25 + var(--r) * 0.75);
		filter: blur(calc((1 - var(--r)) * 3px));
		transform: translateX(calc((1 - var(--r)) * (var(--i) - 1.5) * 14px));
	}
	.row + .row {
		border-top: 1px solid color-mix(in srgb, var(--hairline) calc(var(--r) * 100%), transparent);
	}
	.k {
		color: var(--ink-2);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.66rem;
	}
	.v {
		color: var(--ink-0);
	}

	.essentials {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		min-height: 52px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		justify-content: center;
		gap: 4px 20px;
		padding: 6px 16px;
	}
	.essentials a {
		font: 500 0.66rem/1 var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--ink-1);
		transition: color 160ms ease;
	}
	.essentials a:hover {
		color: var(--accent);
	}

	/* half-width lander: the card would crowd the CTAs */
	.hero.open .card {
		display: none;
	}

	@media (max-width: 720px) {
		.hero.open {
			align-items: start;
			padding-top: 8dvh;
		}
		.hero.open .tag,
		.hero.open .ctas,
		.hero.open .essentials {
			display: none;
		}
		.hero.open .mark {
			font-size: 3.4rem;
		}
		.card {
			display: none;
		}
	}
</style>
