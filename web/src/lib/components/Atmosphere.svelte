<!--
  Atmosphere: the lander's background, a display of identical rounded pixels. The picture on it is
  the mixnet path: you on the left edge, the RPC provider on the right, and three layers of mix
  nodes between, each drawn only as a soft glow in the cells. A request crosses as a snake, winding
  through one node per layer; when it reaches the provider a reply snakes back by another route, as
  replies do on their own reply path. Nothing here is data: it is a picture of what the client does.
  The board dims behind the hero so the text stays quiet. Colours follow the theme tokens.
-->
<script lang="ts">
	import { theme } from '#lib/motion/theme.svelte.ts';

	let canvas: HTMLCanvasElement;

	type Point = [number, number];
	type Snake = { path: Point[]; length: number[]; s: number; reply: boolean; hit: Set<number> };
	type Node = { x: number; y: number; pulse: number; phase: number };

	const PITCH = 13;
	const SIZE = 10;
	const RADIUS = 2.4;
	const BODY = 16; // cells of snake behind the head
	const SPEED = 15; // cells per second at full pace
	const NODE_RADIUS = 4.6;

	$effect(() => {
		// re-read colours whenever the theme flips
		void theme.value;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const css = getComputedStyle(document.documentElement);
		const accent = css.getPropertyValue('--accent').trim() || '#0f8a72';
		const ink = css.getPropertyValue('--ink-0').trim() || '#102028';
		const faint = css.getPropertyValue('--ink-2').trim() || '#8a9aa2';
		const label = css.getPropertyValue('--ink-1').trim() || '#4d5f68';
		const font = css.getPropertyValue('--font-body').trim() || 'sans-serif';
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const board = document.createElement('canvas');

		let w = 0;
		let h = 0;
		let cols = 0;
		let rows = 0;
		let quiet = new Float32Array(0); // per-cell dimming behind the hero
		let green = new Float32Array(0);
		let white = new Float32Array(0);
		const lit: number[] = [];
		let layers: Node[][] = [];
		let you: Point = [0, 0];
		let rpc: Point = [0, 0];
		const snakes: Snake[] = [];

		const smooth = (a: number, b: number, x: number) => {
			const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
			return t * t * (3 - 2 * t);
		};

		function cell(c: CanvasRenderingContext2D, x: number, y: number) {
			c.beginPath();
			c.roundRect(
				x * PITCH + (PITCH - SIZE) / 2,
				y * PITCH + (PITCH - SIZE) / 2,
				SIZE,
				SIZE,
				RADIUS
			);
			c.fill();
		}

		function glow(x: number, y: number, [cx, cy]: Point, r: number) {
			const d = Math.hypot(x - cx, (y - cy) * 0.8) / r;
			return d >= 1 ? 0 : Math.pow(1 - d * d, 2);
		}

		function layout() {
			const dpr = Math.min(devicePixelRatio || 1, 2);
			w = canvas.clientWidth;
			h = canvas.clientHeight;
			canvas.width = board.width = w * dpr;
			canvas.height = board.height = h * dpr;
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			cols = Math.ceil(w / PITCH);
			rows = Math.ceil(h / PITCH);
			quiet = new Float32Array(cols * rows);
			green = new Float32Array(cols * rows);
			white = new Float32Array(cols * rows);
			lit.length = 0;
			for (let y = 0; y < rows; y++)
				for (let x = 0; x < cols; x++) {
					const dx = (x / cols - 0.5) / 0.34;
					const dy = (y / rows - 0.47) / 0.4;
					quiet[y * cols + x] = 0.3 + 0.7 * smooth(0.55, 1.15, Math.hypot(dx, dy));
				}

			you = [-1.5, rows * 0.5];
			rpc = [cols + 0.5, rows * 0.5];
			const n = Math.max(3, Math.min(5, Math.round(rows / 15)));
			layers = [0.27, 0.5, 0.73].map((fx, li) =>
				Array.from({ length: n }, (_, i) => ({
					x: Math.round(cols * fx + Math.sin(i * 1.9 + li * 2.1) * cols * 0.04),
					y: Math.round(
						rows * (0.1 + (0.74 * (i + 0.5)) / n) + Math.cos(i * 2.7 + li) * rows * 0.03
					),
					pulse: 0,
					phase: Math.random() * Math.PI * 2
				}))
			);
			snakes.length = 0;

			// the board itself: every cell, faint, with the two ends glowing in from the edges
			const b = board.getContext('2d')!;
			b.setTransform(dpr, 0, 0, dpr, 0, 0);
			b.clearRect(0, 0, w, h);
			for (let y = 0; y < rows; y++)
				for (let x = 0; x < cols; x++) {
					const q = quiet[y * cols + x];
					b.fillStyle = faint;
					b.globalAlpha = (theme.value === 'dark' ? 0.11 : 0.085) * q;
					cell(b, x, y);
					const end = Math.max(glow(x, y, you, 7.5), glow(x, y, rpc, 7.5));
					if (end > 0.02) {
						b.fillStyle = ink;
						b.globalAlpha = 0.34 * end * q;
						cell(b, x, y);
					}
				}
			b.globalAlpha = 0.75;
			b.fillStyle = label;
			b.font = `600 11px ${font}`;
			b.textBaseline = 'top';
			const ly = (rows * 0.5 + 9) * PITCH;
			b.textAlign = 'left';
			b.fillText('You', 14, ly);
			b.textAlign = 'right';
			b.fillText('RPC provider', w - 14, ly);
		}

		const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

		// Catmull-Rom through the waypoints with a slow lateral wave, sampled by length
		function route(points: Point[]) {
			const path: Point[] = [];
			const wave = 0.9 + Math.random() * 0.8;
			const phase = Math.random() * Math.PI * 2;
			for (let i = 0; i < points.length - 1; i++) {
				const p0 = points[Math.max(0, i - 1)];
				const [p1, p2] = [points[i], points[i + 1]];
				const p3 = points[Math.min(points.length - 1, i + 2)];
				const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 3);
				for (let k = 0; k < steps; k++) {
					const t = k / steps;
					const t2 = t * t;
					const t3 = t2 * t;
					const f = (a: number, b: number, c: number, d: number) =>
						0.5 *
						(2 * b +
							(-a + c) * t +
							(2 * a - 5 * b + 4 * c - d) * t2 +
							(-a + 3 * b - 3 * c + d) * t3);
					// the wave fades to nothing at each node, so the snake threads through it
					const swing = Math.sin(Math.PI * t) * wave * Math.sin(t * Math.PI * 3 + phase + i);
					path.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1]) + swing]);
				}
			}
			path.push(points[points.length - 1]);
			const length = [0];
			for (let i = 1; i < path.length; i++)
				length.push(
					length[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
				);
			return { path, length };
		}

		function spawn(reply: boolean) {
			const hops = layers.map(pick).map((n): Point => [n.x, n.y]);
			const points: Point[] = reply ? [rpc, ...hops.reverse(), you] : [you, ...hops, rpc];
			snakes.push({ ...route(points), s: 0, reply, hit: new Set() });
		}

		function at(sn: Snake, s: number): Point | null {
			if (s < 0 || s > sn.length[sn.length.length - 1]) return null;
			let lo = 0;
			let hi = sn.length.length - 1;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (sn.length[mid] < s) lo = mid;
				else hi = mid;
			}
			const k = (s - sn.length[lo]) / (sn.length[hi] - sn.length[lo] || 1);
			return [
				sn.path[lo][0] + (sn.path[hi][0] - sn.path[lo][0]) * k,
				sn.path[lo][1] + (sn.path[hi][1] - sn.path[lo][1]) * k
			];
		}

		function light(buf: Float32Array, x: number, y: number, v: number) {
			x = Math.round(x);
			y = Math.round(y);
			if (x < 0 || y < 0 || x >= cols || y >= rows) return;
			const i = y * cols + x;
			if (!green[i] && !white[i]) lit.push(i);
			if (v > buf[i]) buf[i] = v;
		}

		function draw(now: number) {
			for (const i of lit) green[i] = white[i] = 0;
			lit.length = 0;

			for (const layer of layers)
				for (const n of layer) {
					const breath = 0.5 + 0.5 * Math.sin(now / 1400 + n.phase);
					const strength = 0.24 + 0.1 * breath + 0.6 * n.pulse;
					const r = Math.ceil(NODE_RADIUS + 1);
					for (let dy = -r; dy <= r; dy++)
						for (let dx = -r; dx <= r; dx++) {
							const g = glow(n.x + dx, n.y + dy, [n.x, n.y], NODE_RADIUS + n.pulse);
							if (g > 0.02) light(green, n.x + dx, n.y + dy, strength * g);
						}
				}

			for (const sn of snakes) {
				const buf = sn.reply ? white : green;
				const peak = sn.reply ? 0.62 : 1;
				for (let k = 0; k <= BODY * 2; k++) {
					const p = at(sn, sn.s - k * 0.5);
					if (p) light(buf, p[0], p[1], peak * Math.pow(1 - k / (BODY * 2 + 1), 1.6));
				}
			}

			ctx!.clearRect(0, 0, w, h);
			ctx!.globalAlpha = 1;
			ctx!.drawImage(board, 0, 0, w, h);
			for (const [buf, colour] of [
				[green, accent],
				[white, ink]
			] as const) {
				ctx!.fillStyle = colour;
				for (const i of lit) {
					if (!buf[i]) continue;
					ctx!.globalAlpha = Math.min(1, buf[i]) * quiet[i];
					cell(ctx!, i % cols, Math.floor(i / cols));
				}
			}
			ctx!.globalAlpha = 1;
		}

		let raf = 0;
		let last = performance.now();
		let nextRequest = 0;
		const replies: ReturnType<typeof setTimeout>[] = [];
		function tick(now: number) {
			const dt = Math.min(64, now - last) / 1000;
			last = now;
			if (now > nextRequest && snakes.filter((s) => !s.reply).length < 4) {
				spawn(false);
				nextRequest = now + 1400 + Math.random() * 1800;
			}
			const nodes = layers.flat();
			for (const n of nodes) n.pulse = Math.max(0, n.pulse - dt * 1.6);
			for (let i = snakes.length - 1; i >= 0; i--) {
				const sn = snakes[i];
				const head = at(sn, sn.s);
				// slow into each node, as a mix node holds a packet a moment
				let near = 1;
				if (head)
					nodes.forEach((n, j) => {
						const d = Math.hypot(head[0] - n.x, head[1] - n.y);
						near = Math.min(near, 0.3 + 0.7 * smooth(0, 4, d));
						if (d < 1 && !sn.hit.has(j)) {
							sn.hit.add(j);
							n.pulse = 1;
						}
					});
				sn.s += SPEED * near * dt;
				if (sn.s - BODY > sn.length[sn.length.length - 1]) {
					snakes.splice(i, 1);
					if (!sn.reply) replies.push(setTimeout(() => spawn(true), 500 + Math.random() * 700));
				}
			}
			draw(now);
			raf = requestAnimationFrame(tick);
		}

		function still() {
			for (let i = 0; i < 4; i++) {
				spawn(i % 2 === 1);
				const sn = snakes[snakes.length - 1];
				sn.s = sn.length[sn.length.length - 1] * (0.2 + i * 0.2);
			}
			draw(performance.now());
		}

		layout();
		const ro = new ResizeObserver(() => {
			layout();
			if (reduced) still();
		});
		ro.observe(canvas);
		// the labels are drawn in the web font, which may still be loading
		document.fonts?.ready.then(() => {
			layout();
			if (reduced) still();
		});
		if (reduced) still();
		else raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
			replies.forEach(clearTimeout);
			ro.disconnect();
		};
	});
</script>

<div class="sky" aria-hidden="true">
	<canvas bind:this={canvas}></canvas>
</div>

<style>
	.sky {
		position: absolute;
		inset: 0;
		z-index: 0;
		background: var(--sky);
		transition: background 400ms ease;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
