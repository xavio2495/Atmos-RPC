<!--
  Preloader: the wordmark placed exactly over the lander's own (measured from the page, same
  font and size), so when it fades the mark stays put while the display resolves under it. Below it the pixel arrow fills in
  cell by cell as the progress runs. Holds for webfonts, then releases the notches
  (boot.ready). Shows once; the layout persists across client navigations.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import { boot } from '#lib/motion/boot.svelte.ts';

	let progress = $state(0);
	let done = $state(false);
	let spot = $state<{ left: number; top: number; size: string } | null>(null);

	// track where the lander's wordmark is drawn, so this one sits on it to the pixel
	$effect(() => {
		const target = document.querySelector('.hero .mark');
		if (!target) return;
		const place = () => {
			const r = target.getBoundingClientRect();
			spot = { left: r.left, top: r.top, size: getComputedStyle(target).fontSize };
		};
		const ro = new ResizeObserver(place);
		ro.observe(target);
		document.fonts?.ready.then(place);
		addEventListener('resize', place);
		return () => {
			ro.disconnect();
			removeEventListener('resize', place);
		};
	});
	const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

	// The arrow mark, 9 × 10 cells: # is solid, 3/2/1 fade into the hollow.
	const ARROW = [
		'....#....',
		'...###...',
		'..#####..',
		'.###3###.',
		'###323###',
		'##32123##',
		'#3210123#',
		'3210.0123',
		'210...012',
		'10.....01'
	];
	const OPACITY: Record<string, number> = { '#': 1, '3': 0.75, '2': 0.5, '1': 0.25 };
	const cells = ARROW.flatMap((row, y) =>
		[...row].flatMap((ch, x) => (ch in OPACITY ? [{ x, y, o: OPACITY[ch] }] : []))
	);
	const lit = $derived(Math.round(progress * cells.length));

	$effect(() => {
		const duration = 2200;
		const start = performance.now();
		let raf = 0;
		const tick = (t: number) => {
			const p = Math.min(1, (t - start) / duration);
			progress = easeOut(p);
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
		<span
			class="mark"
			class:placed={spot}
			style:left={spot ? `${spot.left}px` : null}
			style:top={spot ? `${spot.top}px` : null}
			style:font-size={spot?.size}>atmos</span
		>
		<svg class="arrow" viewBox="0 0 90 100" aria-hidden="true">
			<defs>
				<linearGradient
					id="preloader-arrow"
					gradientUnits="userSpaceOnUse"
					x1="0"
					y1="0"
					x2="0"
					y2="100"
				>
					<stop offset="0" style="stop-color: var(--ink-0)" />
					<stop offset="1" style="stop-color: var(--accent)" />
				</linearGradient>
			</defs>
			{#each cells as c, i (i)}
				<rect
					x={c.x * 10 + 0.5}
					y={c.y * 10 + 0.5}
					width="9"
					height="9"
					rx="2"
					fill="url(#preloader-arrow)"
					opacity={i < lit ? c.o : 0}
				/>
			{/each}
		</svg>
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
	/* same font, size and spacing as the lander's .mark */
	.mark {
		position: fixed;
		margin: 0;
		white-space: nowrap;
		font: 400 clamp(2.8rem, 7.4vw, 5.8rem) / 1 var(--font-title);
		letter-spacing: 0.04em;
		color: var(--ink-0);
		opacity: 0;
	}
	.mark.placed {
		opacity: 1;
	}
	.arrow {
		position: absolute;
		left: 50%;
		bottom: 11%;
		width: 63px;
		transform: translateX(-50%);
	}
	rect {
		transition: opacity 160ms ease;
	}
</style>
