<!--
  Hero: the persistent left tile. The wordmark, one line of pitch, two doors (docs for
  builders, benchmarks for the sceptical), and the one-line install of the local host.
-->
<script lang="ts">
	import CopyLine from '#lib/components/CopyLine.svelte';

	let { open = false }: { open?: boolean } = $props();
</script>

<div class="hero" class:open>
	<div class="block">
		<h1 class="mark">atmos</h1>
		<p class="tag">Anonymous Ethereum RPC that is fast enough to leave on.</p>

		<div class="ctas">
			<a class="cta primary" href="/docs/">Read the docs <span aria-hidden="true">→</span></a>
			<a class="cta ghost" href="/benchmarks/">See the benchmark</a>
		</div>

		<div class="install">
			<p class="step">Run it on your machine</p>
			<CopyLine text="curl -fsSL https://atmos.xavio.dev/install.sh | sh" />
			<p class="step">Then add this to MetaMask as a Sepolia network</p>
			<CopyLine text="http://127.0.0.1:8545/11155111" />
			<p class="note">
				The repository is private for now; the installer works once it's public.
				<a href="/docs/install/">Install guide</a>
			</p>
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
		grid-template-columns: minmax(0, 1fr);
		place-items: center;
		padding: clamp(24px, 4vw, 56px);
	}
	.block {
		width: min(100%, 560px);
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.mark {
		margin: 0;
		font: 400 clamp(2.8rem, 7.4vw, 5.8rem) / 1 var(--font-title);
		letter-spacing: 0.04em;
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
		font: 600 0.86rem/1 var(--font-body);
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

	.install {
		margin-top: clamp(28px, 4vw, 44px);
		width: min(100%, 540px);
		display: flex;
		flex-direction: column;
		gap: 8px;
		text-align: left;
	}
	.step {
		margin: 6px 0 0;
		font: 600 0.8rem/1.3 var(--font-body);
		color: var(--ink-1);
	}
	.note {
		margin: 4px 0 0;
		font: 400 0.76rem/1.5 var(--font-body);
		color: var(--ink-2);
	}
	.note a {
		color: var(--accent);
		font-weight: 600;
		white-space: nowrap;
	}
	.install :global(.line) {
		margin: 0;
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
		font: 500 0.78rem/1 var(--font-body);
		color: var(--ink-1);
		transition: color 160ms ease;
	}
	.essentials a:hover {
		color: var(--accent);
	}

	/* half-width lander: the install block would crowd the CTAs */
	.hero.open .install {
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
			font-size: 2.4rem;
		}
		.install {
			margin-top: 24px;
		}
	}
</style>
