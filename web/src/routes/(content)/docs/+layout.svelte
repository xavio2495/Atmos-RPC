<script lang="ts">
	import { page } from '$app/state';
	import { docs } from '#lib/data/docs.ts';

	let { children } = $props();

	const i = $derived(docs.findIndex((d) => d.href === page.url.pathname));
	const prev = $derived(i > 0 ? docs[i - 1] : null);
	const next = $derived(i >= 0 && i < docs.length - 1 ? docs[i + 1] : null);
</script>

<nav class="docnav" aria-label="Docs">
	{#each docs as d (d.href)}
		<a
			href={d.href}
			class:active={d.href === page.url.pathname}
			aria-current={d.href === page.url.pathname ? 'page' : undefined}>{d.label}</a
		>
	{/each}
</nav>

{#key page.url.pathname}
	<div class="doc">
		{@render children()}
	</div>
{/key}

<nav class="pager" aria-label="Previous and next">
	{#if prev}<a href={prev.href}><small>Previous</small>{prev.label}</a>{:else}<span></span>{/if}
	{#if next}<a class="next" href={next.href}><small>Next</small>{next.label}</a>{/if}
</nav>

<style>
	.docnav {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0 0 32px;
	}
	.docnav a {
		padding: 7px 13px;
		border: 1px solid var(--hairline);
		border-radius: 999px;
		font: 500 0.78rem/1 var(--font-body);
		color: var(--ink-1);
		transition:
			background 160ms ease,
			color 160ms ease;
	}
	.docnav a:hover {
		color: var(--ink-0);
		background: var(--surface-1);
	}
	.docnav a.active {
		color: var(--surface-0);
		background: var(--accent);
		border-color: var(--accent);
	}
	.doc {
		animation: rise 520ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
			filter: blur(3px);
		}
	}
	.pager {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-top: 48px;
		padding-top: 20px;
		border-top: 1px solid var(--hairline);
	}
	.pager a {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font: 600 0.95rem/1.3 var(--font-body);
		color: var(--ink-0);
		border-bottom: none;
	}
	.pager a:hover {
		color: var(--accent);
	}
	.pager .next {
		text-align: right;
	}
	.pager small {
		font: 500 0.74rem/1 var(--font-body);
		color: var(--ink-2);
	}
	@media (prefers-reduced-motion: reduce) {
		.doc {
			animation: none;
		}
	}
</style>
