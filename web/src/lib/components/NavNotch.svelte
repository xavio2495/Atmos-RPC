<!--
  NavNotch: a notch hanging from the lander's top edge. It lives inside the lander, so it
  re-centres as the lander retiles. Clicking the active link routes home and closes the tile.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { boot } from '#lib/motion/boot.svelte.ts';

	const links = [
		{ href: '/how-it-works/', label: 'How it works' },
		{ href: '/compare/', label: 'Compare' },
		{ href: '/benchmarks/', label: 'Benchmarks' },
		{ href: '/demo/', label: 'Demo' },
		{ href: '/docs/', label: 'Docs', cta: true }
	];

	const path = $derived(page.url.pathname);
	const isActive = (href: string) =>
		href === '/docs/' ? path.startsWith('/docs/') : path === href;
</script>

<nav class="notch" class:in={boot.ready} aria-label="Primary">
	{#each links as link (link.href)}
		{@const active = isActive(link.href)}
		<a
			class="link"
			class:cta={link.cta}
			class:active
			href={active && path === link.href ? '/' : link.href}
			aria-current={active ? 'page' : undefined}>{link.label}</a
		>
	{/each}
</nav>

<style>
	.notch {
		position: absolute;
		top: 0;
		left: 50%;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: clamp(14px, 1.8vw, 26px);
		height: 46px;
		padding: 0 10px 0 24px;
		background: var(--paper);
		border-radius: 0 0 20px 20px;
		transform: translate(-50%, -110%);
		opacity: 0;
		transition:
			transform 820ms cubic-bezier(0.16, 1, 0.3, 1) 140ms,
			opacity 620ms ease 140ms,
			background 400ms ease;
	}
	.notch.in {
		transform: translate(-50%, 0);
		opacity: 1;
	}
	.link {
		font: 500 0.72rem/1 var(--font-mono);
		text-transform: uppercase;
		letter-spacing: 0.11em;
		white-space: nowrap;
		color: var(--ink-1);
		padding-bottom: 2px;
		border-bottom: 1px solid transparent;
		transition:
			color 160ms ease,
			border-color 160ms ease;
	}
	.link:hover,
	.link.active {
		color: var(--ink-0);
		border-bottom-color: var(--accent);
	}
	.cta {
		color: var(--surface-0);
		background: var(--accent);
		padding: 9px 15px;
		border-radius: 999px;
		border-bottom: none;
	}
	.cta:hover,
	.cta.active {
		color: var(--surface-0);
		background: var(--accent-deep);
	}
	@media (max-width: 720px) {
		.notch {
			height: 40px;
			gap: clamp(9px, 2.6vw, 15px);
			padding: 0 8px 0 14px;
			border-radius: 0 0 15px 15px;
		}
		.link {
			font-size: 0.58rem;
			letter-spacing: 0.04em;
		}
		.cta {
			padding: 7px 10px;
		}
	}
</style>
