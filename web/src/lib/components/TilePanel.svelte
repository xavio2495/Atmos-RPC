<!--
  TilePanel: the chrome every right-hand tile shares. A close affordance in the top-right
  corner and a scrollable body whose top padding clears the nav band.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<section class="tile" aria-label={label}>
	<a class="close" href="/" aria-label="Close panel"
		><span class="word">close </span><span aria-hidden="true">×</span></a
	>
	<div class="tile-body">
		{@render children()}
	</div>
</section>

<style>
	.tile {
		position: relative;
		height: 100%;
		background: var(--surface-0);
		transition: background 400ms ease;
	}
	.close {
		position: absolute;
		top: 22px;
		right: clamp(20px, 3vw, 40px);
		z-index: 30;
		font: 500 0.68rem/1 var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--ink-2);
		transition: color 160ms ease;
	}
	.close .word {
		margin-right: 0.45em;
	}
	.close:hover {
		color: var(--ink-0);
	}
	.tile-body {
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: clamp(72px, 8vh, 96px) clamp(22px, 3.4vw, 48px) clamp(28px, 4vw, 56px);
	}
	@media (max-width: 720px) {
		.close {
			top: 14px;
			right: 14px;
		}
		.close .word {
			display: none;
		}
	}
</style>
