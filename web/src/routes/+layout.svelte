<script lang="ts">
	import { page } from '$app/state';
	import '#lib/styles/tokens.css';
	import '#lib/styles/prose.css';
	import Preloader from '#lib/components/Preloader.svelte';
	import Atmosphere from '#lib/components/Atmosphere.svelte';
	import NavNotch from '#lib/components/NavNotch.svelte';
	import Hero from '#lib/components/Hero.svelte';
	import { pageMorph } from '#lib/motion/pageMorph.ts';

	let { children } = $props();

	// Any route but home opens a tile: the lander retiles to the left half and the route
	// content morphs into a second rounded window on the right. Docs pages share one key so
	// moving between them doesn't replay the whole window transition.
	const path = $derived(page.url.pathname);
	const open = $derived(path !== '/');
	const key = $derived(path.startsWith('/docs/') ? '/docs/' : path);
	// the decks are full-screen slides, outside the lander and its tiles
	const deck = $derived(path.startsWith('/deck/') || path.startsWith('/pitch/'));
</script>

<svelte:head>
	<title>Atmos: fast, private Ethereum RPC over anon-rpc</title>
	<meta
		name="description"
		content="Atmos is a client layer on top of anon-rpc: batched, failover-ready anonymous Ethereum RPC through the Nym mixnet."
	/>
</svelte:head>

{#if deck}
	{@render children()}
{:else}
	<Preloader />

	<main class="frame">
		<div class="tiles" class:open>
			<section class="lander">
				<Atmosphere />
				<NavNotch />
				<Hero {open} />
			</section>
			<section class="tile-wrap" inert={!open} aria-hidden={!open}>
				{#key key}
					<div class="route" in:pageMorph out:pageMorph>
						{@render children()}
					</div>
				{/key}
			</section>
		</div>
	</main>
{/if}

<style>
	.frame {
		position: fixed;
		inset: 12px;
		z-index: 1;
		background: var(--paper);
		border-radius: 24px;
		overflow: clip;
	}
	.tiles {
		height: 100%;
		display: grid;
		grid-template-columns: 1fr 0fr;
		column-gap: 0px;
		transition:
			grid-template-columns 1500ms cubic-bezier(0.16, 1, 0.3, 1),
			column-gap 1500ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.tiles.open {
		/* the content window gets a little more room than the lander: docs are dense */
		grid-template-columns: 0.9fr 1.1fr;
		column-gap: 12px;
	}
	.lander,
	.tile-wrap {
		position: relative;
		min-width: 0;
		height: 100%;
		border-radius: 24px;
		overflow: hidden;
	}
	.lander {
		container: lander / inline-size;
	}
	.route {
		position: absolute;
		inset: 0;
	}

	@media (max-width: 720px) {
		.frame {
			inset: 8px;
			border-radius: 18px;
		}
		/* the split becomes a bottom sheet over the lander */
		.tiles {
			display: block;
			position: relative;
			transition: none;
		}
		.lander {
			position: absolute;
			inset: 0;
			border-radius: 18px;
		}
		.tile-wrap {
			position: absolute;
			left: 0;
			right: 0;
			bottom: 0;
			height: 76dvh;
			border-radius: 22px 22px 18px 18px;
			transform: translateY(101%);
			transition: transform 640ms cubic-bezier(0.16, 1, 0.3, 1);
			z-index: 30;
		}
		.tiles.open .tile-wrap {
			transform: translateY(0);
		}
	}
</style>
