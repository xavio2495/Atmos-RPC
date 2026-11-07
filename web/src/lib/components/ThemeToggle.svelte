<script lang="ts">
	import { theme, toggleTheme } from '#lib/motion/theme.svelte.ts';

	const dark = $derived(theme.value === 'dark');
</script>

<button
	class="toggle"
	type="button"
	onclick={toggleTheme}
	aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
	aria-pressed={dark}
>
	{#if dark}
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<circle cx="12" cy="12" r="4.2" />
			<path
				d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.5 4.5l2.1 2.1M17.4 17.4l2.1 2.1M4.5 19.5l2.1-2.1M17.4 6.6l2.1-2.1"
			/>
		</svg>
	{:else}
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path class="fill" d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5Z" />
		</svg>
	{/if}
</button>

<style>
	.toggle {
		flex: none;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		cursor: pointer;
		background: none;
		color: var(--ink-0);
		transition: opacity 160ms ease;
	}
	.toggle:hover {
		opacity: 0.6;
	}
	svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
	}
	.fill {
		fill: currentColor;
		stroke: none;
	}
</style>
