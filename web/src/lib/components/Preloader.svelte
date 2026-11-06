<!--
  Preloader: the wordmark set at the same size and centre as the lander's, so when it fades the
  mark reads as staying put while the sky resolves under it. Holds for webfonts, then releases
  the notches (boot.ready). Shows once; the layout persists across client navigations.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import { boot } from '#lib/motion/boot.svelte.ts';

	let pct = $state(0);
	let done = $state(false);
	const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

	$effect(() => {
		const duration = 2200;
		const start = performance.now();
		let raf = 0;
		const tick = (t: number) => {
			const p = Math.min(1, (t - start) / duration);
			pct = Math.round(easeOut(p) * 100);
			if (p < 1) raf = requestAnimationFrame(tick);
			else
				Promise.resolve(document.fonts?.ready).then(() =>
					setTimeout(() => {
						done = true;
						boot.ready = true;
					}, 150)
				);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
</script>

{#if !done}
	<div class="preloader" out:fade={{ duration: 640 }}>
		<span class="mark">atmos</span>
		<span class="pct">{pct}%</span>
	</div>
{/if}

<style>
	.preloader {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: var(--paper);
		display: grid;
		place-items: center;
	}
	.mark {
		font: 640 clamp(4.2rem, 11vw, 8.6rem) / 0.86 var(--font-display);
		letter-spacing: -0.06em;
		color: var(--ink-0);
		transform: translateY(-6dvh);
	}
	.pct {
		position: absolute;
		left: 50%;
		bottom: 13%;
		transform: translateX(-50%);
		font: 500 0.8rem/1 var(--font-mono);
		letter-spacing: 0.2em;
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}
</style>
