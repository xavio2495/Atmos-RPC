<!--
  NavNotch: a notch hanging from the lander's top edge. It lives inside the lander, so it
  re-centres as the lander retiles. Clicking the active link routes home and closes the tile.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { boot } from '#lib/motion/boot.svelte.ts';
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';

	// SDK and Install are shortcuts into the docs; Compare is linked from the lander's footer.
	const links = [
		{ href: '/how-it-works/', label: 'How it works' },
		{ href: '/benchmarks/', label: 'Benchmarks' },
		{ href: '/demo/', label: 'Demo' },
		{ href: '/docs/sdk/', label: 'SDK' },
		{ href: '/docs/install/', label: 'Install' },
		{ href: '/docs/', label: 'Docs', cta: true }
	];
	const shortcuts = links.filter((l) => l.href.startsWith('/docs/') && l.href !== '/docs/');

	const path = $derived(page.url.pathname);
	const isActive = (href: string) =>
		href === '/docs/'
			? path.startsWith('/docs/') && !shortcuts.some((l) => l.href === path)
			: path === href;
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
	<ThemeToggle />
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
		padding: 0 12px 0 24px;
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
		font: 600 0.8rem/1 var(--font-body);
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
	/* sized to the lander, which is half the screen while a tile is open */
	@container lander (max-width: 560px) {
		.notch {
			height: 40px;
			gap: 11px;
			padding: 0 8px 0 14px;
			border-radius: 0 0 15px 15px;
		}
		.link {
			font-size: 0.72rem;
		}
		.cta {
			padding: 7px 10px;
		}
	}
	@container lander (max-width: 400px) {
		.notch {
			gap: 8px;
			padding: 0 6px 0 10px;
		}
		.link {
			font-size: 0.66rem;
		}
	}
	@container lander (max-width: 360px) {
		.notch {
			gap: 6px;
		}
		.link {
			font-size: 0.6rem;
		}
		.cta {
			padding: 6px 8px;
		}
	}
</style>
