<!--
  HowDiagram: the animated figures on the how-it-works page, drawn in the site's pixel style
  (rounded square cells) and animated with SMIL and CSS only. Each figure follows the code:
  path     - wallet, local host, SDK, the sandboxed worker, then entry, three mix layers, exit and
             provider; the reply returns on its own route; a standby route stays warm.
  verify   - sync-committee signatures to a verified head, its state root, a checked proof, the answer.
  shape    - calls as they are made, against a fixed clock of slots with dummies in the gaps.
  lists    - each block's access list, the same for everyone, checked against the header and
             applied to the accounts held, so a repeat read sends nothing.
  With reduced motion the moving parts are hidden and the figure stands still.
-->
<script lang="ts">
	let { kind }: { kind: 'path' | 'verify' | 'shape' | 'lists' } = $props();

	type Stop = { x: number; y: number; label: string; sub?: string; tone: 'end' | 'mine' | 'net' };

	// the path as a snakes-and-ladders board: along your machine, down, back across the mixnet
	const stops: Stop[] = [
		{ x: 60, y: 60, label: 'Wallet', tone: 'end' },
		{ x: 190, y: 60, label: 'Local host', sub: '127.0.0.1:8545', tone: 'mine' },
		{ x: 320, y: 60, label: 'Atmos SDK', sub: 'routes, batches, checks', tone: 'mine' },
		{ x: 470, y: 60, label: 'Nym worker', sub: "anon-rpc's sandbox", tone: 'mine' },
		{ x: 580, y: 180, label: 'Entry', tone: 'net' },
		{ x: 470, y: 180, label: 'Mix 1', tone: 'net' },
		{ x: 360, y: 180, label: 'Mix 2', tone: 'net' },
		{ x: 250, y: 180, label: 'Mix 3', tone: 'net' },
		{ x: 140, y: 180, label: 'Exit', sub: 'IPR', tone: 'net' },
		{ x: 40, y: 180, label: 'RPC provider', tone: 'end' }
	];
	const route = 'M60,60 H580 V180 H40';
	const back = 'M40,180 H580 V60 H60';
	const block = [-7, 0, 7].flatMap((dx) => [-7, 0, 7].map((dy) => [dx, dy]));

	const stages = [
		{ label: 'Sync committee', sub: 'signed by 512 validators' },
		{ label: 'Verified head', sub: 'light client' },
		{ label: 'State root', sub: 'in that header' },
		{ label: 'Proof checked', sub: 'eth_getProof' },
		{ label: 'Answer', sub: 'to your code' }
	];

	// one clock slot every 40 px; calls the wallet made land in slots, dummies fill the rest
	const slots = Array.from({ length: 16 }, (_, i) => i);
	const real = new Set([1, 2, 3, 7, 12]);
	const bursty = [8, 20, 32, 44, 150, 162, 290, 302, 314, 450, 470];
</script>

<figure class="how {kind}">
	{#if kind === 'path'}
		<svg viewBox="0 0 640 260" role="img" aria-labelledby="fig-path">
			<title id="fig-path">
				A request leaves the wallet through the local host, the SDK and the sandboxed Nym worker,
				then crosses the entry gateway, three mix layers and the exit to the RPC provider. The reply
				comes back on its own route. A standby route stays warm.
			</title>
			<rect class="zone" x="16" y="128" width="608" height="88" rx="10" />
			<text class="zonelabel" x="28" y="146">Nym mixnet</text>
			<rect class="sandbox" x="420" y="22" width="100" height="84" rx="8" />
			<path class="wire" d={route} />
			{#each stops as s (s.label)}
				<g class="stop {s.tone}">
					{#each block as [dx, dy], i (i)}
						<rect x={s.x + dx - 3} y={s.y + dy - 3} width="6" height="6" rx="1.4" />
					{/each}
					<text class="label" x={s.x} y={s.y + (s.y < 100 ? -18 : 26)}>{s.label}</text>
					{#if s.sub}<text class="sub" x={s.x} y={s.y + (s.y < 100 ? 26 : 38)}>{s.sub}</text>{/if}
				</g>
			{/each}
			<g class="standby">
				{#each [580, 470, 360, 250, 140] as x (x)}
					{#each [-4, 4] as dx (dx)}<rect
							x={x + dx - 3}
							y="233"
							width="6"
							height="6"
							rx="1.4"
						/>{/each}
				{/each}
				<text class="sub" x="320" y="256"
					>standby route, warm · routes rotate about every 10 minutes</text
				>
			</g>
			<g class="moving">
				{#each [0, 0.12, 0.24] as lag, k (k)}
					<rect class="req" width="8" height="8" rx="2" x="-4" y="-4" opacity={1 - k * 0.3}>
						<animateMotion
							dur="8s"
							repeatCount="indefinite"
							path={route}
							keyPoints="0;1;1"
							keyTimes="0;0.45;1"
							calcMode="linear"
							begin="{-lag}s"
						/>
					</rect>
					<rect class="rep" width="8" height="8" rx="2" x="-4" y="-4" opacity={1 - k * 0.3}>
						<animateMotion
							dur="8s"
							repeatCount="indefinite"
							path={back}
							keyPoints="0;0;1;1"
							keyTimes="0;0.5;0.95;1"
							calcMode="linear"
							begin="{-lag}s"
						/>
					</rect>
				{/each}
			</g>
		</svg>
		<figcaption>
			<span class="key req"></span>request <span class="key rep"></span>reply, on its own reply path
			· only the Nym directory and the entry gateway see your IP; the provider sees the exit
		</figcaption>
	{:else if kind === 'verify'}
		<svg viewBox="0 0 640 180" role="img" aria-labelledby="fig-verify">
			<title id="fig-verify">
				Sync-committee signatures give a verified head; its state root checks the provider's proof;
				only then does the answer reach your code. A wrong proof ends in a failure, never a wrong
				answer.
			</title>
			<path class="wire" d="M64,60 H576" />
			{#each stages as st, i (st.label)}
				{@const x = 64 + i * 128}
				<g class="stage" style:--i={i}>
					{#each block as [dx, dy], j (j)}
						<rect x={x + dx - 3} y={60 + dy - 3} width="6" height="6" rx="1.4" />
					{/each}
					<text class="label" {x} y="34">{st.label}</text>
					<text class="sub" {x} y="90">{st.sub}</text>
				</g>
			{/each}
			<path class="wire faint" d="M448,140 V72" />
			<g class="stop end">
				{#each [-4, 4] as dx (dx)}{#each [-4, 4] as dy (dy)}<rect
							x={448 + dx - 3}
							y={148 + dy - 3}
							width="6"
							height="6"
							rx="1.4"
						/>{/each}{/each}
			</g>
			<text class="sub left" x="462" y="146">RPC provider sends the value</text>
			<text class="sub left" x="462" y="158">and its Merkle proof</text>
			<path class="wire faint" d="M320,72 V140" />
			<text class="sub left" x="250" y="140">eth_call runs in a</text>
			<text class="sub left" x="250" y="152">local EVM on proven state</text>
			<text class="sub left" x="16" y="140">a proof that does not match:</text>
			<text class="sub left fail" x="16" y="152">a failure, never a wrong answer</text>
		</svg>
	{:else if kind === 'shape'}
		<svg viewBox="0 0 640 170" role="img" aria-labelledby="fig-shape">
			<title id="fig-shape">
				Without shaping, requests leave in bursts when the wallet is busy. With shaping they leave
				on a fixed clock, one per slot, with dummies filling the empty slots, so an observer sees
				the same steady stream either way.
			</title>
			<text class="label left" x="16" y="34">Not shaped</text>
			<text class="sub left" x="16" y="48">bursts show when you are busy</text>
			<text class="label left" x="16" y="104">Shaped</text>
			<text class="sub left" x="16" y="118">one per slot, dummies in the gaps</text>
			<clipPath id="lane"><rect x="200" y="0" width="430" height="170" /></clipPath>
			<g clip-path="url(#lane)">
				<line class="wire" x1="200" x2="630" y1="40" y2="40" />
				<line class="wire" x1="200" x2="630" y1="110" y2="110" />
				<g class="drift">
					{#each [0, 640] as off (off)}
						{#each bursty as b (b)}<rect
								class="req"
								x={200 + off + b}
								y="36"
								width="8"
								height="8"
								rx="2"
							/>{/each}
						{#each slots as s (s)}
							<rect
								class={real.has(s) ? 'req' : 'dummy'}
								x={200 + off + s * 40}
								y="106"
								width="8"
								height="8"
								rx="2"
							/>
						{/each}
					{/each}
				</g>
			</g>
			<text class="sub" x="415" y="150"
				>what an observer sees on the shaped lane: one packet a slot</text
			>
		</svg>
		<figcaption>
			<span class="key req"></span>a call you made <span class="key dummy"></span>a dummy · covers
			outgoing requests; replies are not padded
		</figcaption>
	{:else}
		<svg viewBox="0 0 640 200" role="img" aria-labelledby="fig-lists">
			<title id="fig-lists">
				Every block's access list is fetched, the same list for every client, and checked against
				the block header. It updates the accounts already held, so reading one of them again answers
				locally and sends nothing.
			</title>
			<text class="label left" x="16" y="24">Each new block</text>
			<g class="blocks">
				{#each [0, 1, 2, 3] as b (b)}
					<g class="blk" style:--b={b}>
						<rect class="frame" x={40 + b * 70} y="38" width="52" height="40" rx="6" />
						{#each [0, 1, 2, 3, 4, 5] as c (c)}
							<rect
								class="cell"
								x={48 + b * 70 + (c % 3) * 13}
								y={46 + Math.floor(c / 3) * 13}
								width="9"
								height="9"
								rx="2"
							/>
						{/each}
					</g>
				{/each}
			</g>
			<text class="sub left" x="40" y="96"
				>the same list for everyone, checked against the header</text
			>
			<path class="wire" d="M320,58 H400" />
			<text class="label" x="470" y="24">Accounts you hold</text>
			{#each [0, 1, 2] as a (a)}
				<g class="acct" style:--a={a}>
					{#each [-4, 4] as dx (dx)}{#each [-4, 4] as dy (dy)}<rect
								x={430 + a * 40 + dx - 3}
								y={58 + dy - 3}
								width="6"
								height="6"
								rx="1.4"
							/>{/each}{/each}
				</g>
			{/each}
			<path class="wire faint" d="M470,150 V76" />
			<g class="stop end">
				{#each [-4, 4] as dx (dx)}{#each [-4, 4] as dy (dy)}<rect
							x={470 + dx - 3}
							y={160 + dy - 3}
							width="6"
							height="6"
							rx="1.4"
						/>{/each}{/each}
			</g>
			<text class="sub left" x="486" y="158">a repeat read is answered</text>
			<text class="sub left" x="486" y="170">here: no request names it</text>
			<text class="sub left" x="16" y="160">experimental: only while it keeps</text>
			<text class="sub left" x="16" y="172">pace; behind, reads fall back to proofs</text>
		</svg>
	{/if}
</figure>

<style>
	.how {
		margin: 0 0 1.6em;
		padding: 14px 12px 10px;
		border: 1px solid var(--hairline);
		border-radius: var(--radius-md);
		background: var(--surface-2);
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	text {
		font-family: var(--font-body);
		text-anchor: middle;
		fill: var(--ink-1);
	}
	.label {
		font-size: 12px;
		font-weight: 600;
		fill: var(--ink-0);
	}
	.sub {
		font-size: 10px;
	}
	.left {
		text-anchor: start;
	}
	.fail {
		fill: var(--status-error);
	}
	.wire {
		fill: none;
		stroke: var(--hairline);
		stroke-width: 2;
	}
	.wire.faint {
		stroke-dasharray: 3 4;
	}
	.zone {
		fill: var(--surface-0);
		stroke: var(--hairline);
	}
	.zonelabel {
		font-size: 9px;
		font-weight: 600;
		text-anchor: start;
		fill: var(--ink-2);
	}
	.sandbox {
		fill: none;
		stroke: var(--accent);
		stroke-dasharray: 4 4;
		opacity: 0.6;
	}
	.stop rect {
		fill: var(--accent-soft);
	}
	.stop.end rect {
		fill: var(--ink-1);
	}
	.stop.mine rect {
		fill: var(--accent);
	}
	.standby rect {
		fill: var(--hairline);
	}
	.req {
		fill: var(--accent);
	}
	.rep {
		fill: var(--ink-0);
	}
	.dummy {
		fill: var(--ink-2);
		opacity: 0.6;
	}

	/* verify: each stage lights in turn */
	.stage rect {
		fill: var(--hairline);
		animation: light 6s infinite;
		animation-delay: calc(var(--i) * 0.8s);
	}
	@keyframes light {
		0%,
		4% {
			fill: var(--hairline);
		}
		10%,
		70% {
			fill: var(--accent);
		}
		80%,
		100% {
			fill: var(--hairline);
		}
	}

	/* shape: both lanes move toward the provider */
	.drift {
		animation: drift 12s linear infinite;
	}
	@keyframes drift {
		to {
			transform: translateX(-640px);
		}
	}

	/* lists: blocks arrive, their cells check, the held accounts update */
	.blk {
		animation: arrive 4s infinite;
		animation-delay: calc(var(--b) * 1s);
	}
	.blk .frame {
		fill: none;
		stroke: var(--hairline);
	}
	.blk .cell {
		fill: var(--accent-soft);
	}
	@keyframes arrive {
		0%,
		100% {
			opacity: 0.35;
		}
		15%,
		40% {
			opacity: 1;
		}
	}
	.acct rect {
		fill: var(--accent-soft);
		animation: update 4s infinite;
		animation-delay: calc(var(--a) * 0.4s + 0.6s);
	}
	@keyframes update {
		0%,
		20%,
		100% {
			fill: var(--accent-soft);
		}
		8% {
			fill: var(--accent);
		}
	}

	figcaption {
		margin-top: 6px;
		font-size: 0.74rem;
		color: var(--ink-1);
	}
	.key {
		display: inline-block;
		width: 9px;
		height: 9px;
		margin: 0 5px 0 0;
		border-radius: 2px;
		vertical-align: -1px;
	}
	.key.req {
		background: var(--accent);
	}
	.key.rep {
		margin-left: 8px;
		background: var(--ink-0);
	}
	.key.dummy {
		margin-left: 8px;
		background: var(--ink-2);
	}

	@media (prefers-reduced-motion: reduce) {
		.moving {
			display: none;
		}
		.stage rect,
		.blk,
		.acct rect,
		.drift {
			animation: none;
		}
		.stage rect {
			fill: var(--accent);
		}
	}
</style>
