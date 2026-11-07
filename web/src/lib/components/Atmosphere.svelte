<!--
  Atmosphere: the lander's living background, drawn on the pixel grid of the Atmos mark (rounded
  square cells). A dithered field thins toward the horizon; three columns of 2×2 blocks stand for
  the mix layers. Packets enter at the left edge, step cell by cell to one node per layer, pause
  there, and leave to the right, trailing the mark's fade (1, 0.75, 0.5, 0.25). Nothing here is
  data: it is a picture of what the client does. Colours follow the theme tokens.
-->
<script lang="ts">
	import { theme } from '#lib/motion/theme.svelte.ts';

	let canvas: HTMLCanvasElement;

	type Cell = [number, number];
	type Packet = { cells: Cell[]; stops: Set<number>; i: number; wait: number };

	const PITCH = 12;
	const SIZE = PITCH * 0.9;
	const RADIUS = PITCH * 0.2;
	const TRAIL = [1, 0.75, 0.5, 0.25];
	const STEP_MS = 42;
	const STOP_MS = 420;
	// 4×4 ordered dither: turns a smooth density into a pixel gradient
	const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

	$effect(() => {
		// re-read colours whenever the theme flips
		void theme.value;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const css = getComputedStyle(document.documentElement);
		const accent = css.getPropertyValue('--accent').trim() || '#0f8a72';
		const ink = css.getPropertyValue('--ink-2').trim() || '#8a9aa2';
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const field = document.createElement('canvas');

		let w = 0;
		let h = 0;
		let cols = 0;
		let rows = 0;
		let dpr = 1;
		let layers: Cell[][] = [];
		const packets: Packet[] = [];
		const flash = new Map<string, number>();

		const cell = (c: CanvasRenderingContext2D, x: number, y: number, k = 1) => {
			c.beginPath();
			c.roundRect(
				x * PITCH + (PITCH - SIZE * k) / 2,
				y * PITCH + (PITCH - SIZE * k) / 2,
				SIZE * k,
				SIZE * k,
				RADIUS * k
			);
			c.fill();
		};

		function layout() {
			dpr = Math.min(devicePixelRatio || 1, 2);
			w = canvas.clientWidth;
			h = canvas.clientHeight;
			canvas.width = field.width = w * dpr;
			canvas.height = field.height = h * dpr;
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			cols = Math.ceil(w / PITCH);
			rows = Math.ceil(h / PITCH);
			const n = Math.max(5, Math.round(h / 100));
			layers = [0.3, 0.5, 0.7].map((fx, li) =>
				Array.from({ length: n }, (_, i): Cell => [
					Math.round((cols * fx + Math.sin(i * 1.7 + li) * cols * 0.03) / 2) * 2,
					Math.round((rows * (i + 0.5)) / n + Math.cos(i * 2.3 + li) * 1.5)
				])
			);
			packets.length = 0;

			const f = field.getContext('2d')!;
			f.setTransform(dpr, 0, 0, dpr, 0, 0);
			f.clearRect(0, 0, w, h);
			f.fillStyle = ink;
			for (let y = 0; y < rows; y++) {
				const density = 0.42 * Math.pow(1 - y / rows, 1.6);
				for (let x = 0; x < cols; x++) {
					if (BAYER[(y % 4) * 4 + (x % 4)] >= density) continue;
					f.globalAlpha = 0.16;
					cell(f, x, y, 0.55);
				}
			}
			f.globalAlpha = 0.35;
			for (const layer of layers)
				for (const [x, y] of layer)
					for (const [dx, dy] of [
						[0, 0],
						[1, 0],
						[0, 1],
						[1, 1]
					])
						cell(f, x + dx, y + dy);
		}

		const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

		// a 4-connected staircase between two cells, the pixel version of a straight line
		function walk(from: Cell, to: Cell, out: Cell[]) {
			let [x, y] = from;
			const [tx, ty] = to;
			while (x !== tx || y !== ty) {
				const dx = tx - x;
				const dy = ty - y;
				if (Math.random() * (Math.abs(dx) + Math.abs(dy)) < Math.abs(dx)) x += Math.sign(dx);
				else y += Math.sign(dy);
				out.push([x, y]);
			}
		}

		function spawn() {
			const band = () => Math.round(rows * (0.12 + Math.random() * 0.76));
			const points: Cell[] = [[-1, band()], ...layers.map(pick), [cols + TRAIL.length, band()]];
			const cells: Cell[] = [points[0]];
			const stops = new Set<number>();
			for (let i = 1; i < points.length; i++) {
				walk(points[i - 1], points[i], cells);
				if (i < points.length - 1) stops.add(cells.length - 1);
			}
			packets.push({ cells, stops, i: 0, wait: 0 });
		}

		function draw(now: number) {
			ctx!.clearRect(0, 0, w, h);
			ctx!.globalAlpha = 1;
			ctx!.drawImage(field, 0, 0, w, h);
			ctx!.fillStyle = accent;
			for (const [key, until] of flash) {
				const left = until - now;
				if (left <= 0) {
					flash.delete(key);
					continue;
				}
				const [x, y] = key.split(',').map(Number);
				ctx!.globalAlpha = 0.85 * (left / STOP_MS);
				for (const [dx, dy] of [
					[0, 0],
					[1, 0],
					[0, 1],
					[1, 1]
				])
					cell(ctx!, x + dx, y + dy);
			}
			for (const p of packets) {
				const head = Math.floor(p.i);
				TRAIL.forEach((o, k) => {
					const c = p.cells[head - k];
					if (!c) return;
					ctx!.globalAlpha = o;
					cell(ctx!, c[0], c[1]);
				});
			}
			ctx!.globalAlpha = 1;
		}

		let raf = 0;
		let last = performance.now();
		function tick(now: number) {
			const dt = Math.min(64, now - last);
			last = now;
			if (packets.length < 7 && Math.random() < dt / 650) spawn();
			for (const p of packets) {
				if (p.wait > 0) {
					p.wait -= dt;
					continue;
				}
				const before = Math.floor(p.i);
				p.i += dt / STEP_MS;
				const after = Math.floor(p.i);
				for (let s = before + 1; s <= after; s++)
					if (p.stops.has(s)) {
						p.i = s;
						p.wait = STOP_MS;
						const node = layers.flat().find(([x, y]) => x === p.cells[s][0] && y === p.cells[s][1]);
						if (node) flash.set(`${node[0]},${node[1]}`, now + STOP_MS);
						break;
					}
			}
			for (let i = packets.length - 1; i >= 0; i--)
				if (packets[i].i >= packets[i].cells.length + TRAIL.length) packets.splice(i, 1);
			draw(now);
			raf = requestAnimationFrame(tick);
		}

		function still() {
			for (let i = 0; i < 6; i++) {
				spawn();
				packets[packets.length - 1].i = Math.floor(
					(packets[packets.length - 1].cells.length * (i + 0.5)) / 6
				);
			}
			draw(performance.now());
		}

		layout();
		const ro = new ResizeObserver(() => {
			layout();
			if (reduced) still();
		});
		ro.observe(canvas);
		if (reduced) still();
		else raf = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(raf);
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
