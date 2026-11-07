<!--
  TilePanel: the chrome every right-hand tile shares. A fixed top bar holding the close link,
  so scrolled content never runs under it, and a scrollable body.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<section class="tile" aria-label={label}>
	<div class="bar">
		<a class="close" href="/" aria-label="Close panel"
			><span class="word">Close</span><span aria-hidden="true">×</span></a
		>
	</div>
	<div class="tile-body">
		{@render children()}
	</div>
</section>

<style>
	.tile {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--surface-0);
		transition: background 400ms ease;
	}
	.bar {
		flex: none;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		height: 56px;
		padding: 0 clamp(20px, 3vw, 40px);
		border-bottom: 1px solid var(--hairline);
	}
	.close {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		padding: 6px 2px;
		font: 600 0.78rem/1 var(--font-body);
		color: var(--ink-1);
		transition: color 160ms ease;
	}
	.close:hover {
		color: var(--ink-0);
	}
	.tile-body {
		container: tile / inline-size;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: clamp(28px, 4vh, 44px) clamp(22px, 3.4vw, 48px) clamp(28px, 4vw, 56px);
	}
	@media (max-width: 720px) {
		.bar {
			height: 44px;
			padding: 0 14px;
		}
		.close .word {
			display: none;
		}
	}
</style>
