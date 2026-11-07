<!--
  CopyLine: one line of code with a copy button, for commands and URLs a visitor pastes elsewhere.
-->
<script lang="ts">
	let { text, label = 'Copy' }: { text: string; label?: string } = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	async function copy() {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			return;
		}
		copied = true;
		clearTimeout(timer);
		timer = setTimeout(() => (copied = false), 1600);
	}
</script>

<div class="line">
	<code>{text}</code>
	<button type="button" onclick={copy} aria-label="{label}: {text}">
		{copied ? 'Copied' : label}
	</button>
	<span class="sr" aria-live="polite">{copied ? 'Copied to the clipboard' : ''}</span>
</div>

<style>
	.line {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		margin: 0 0 1.2em;
		padding: 6px 6px 6px 14px;
		background: var(--surface-1);
		border: 1px solid var(--hairline);
		border-radius: var(--radius-sm);
	}
	code {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		font: 400 0.84rem/1.6 var(--font-mono);
		color: var(--ink-0);
		background: none;
		padding: 0;
		scrollbar-width: none;
	}
	button {
		flex: none;
		min-width: 4.6rem;
		padding: 7px 12px;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		background: var(--surface-0);
		color: var(--ink-0);
		font: 600 0.76rem/1 var(--font-body);
		cursor: pointer;
		transition: border-color 160ms ease;
	}
	button:hover {
		border-color: var(--accent);
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
