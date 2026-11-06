<script lang="ts">
	import TilePanel from '#lib/components/TilePanel.svelte';

	let { children } = $props();
</script>

<TilePanel label="Page">
	<article class="prose">
		{@render children()}
	</article>
</TilePanel>
