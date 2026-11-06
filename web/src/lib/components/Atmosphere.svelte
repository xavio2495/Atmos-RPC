<!--
  Atmosphere: the lander's living background. Three faint columns of nodes stand for the mix
  layers; packets enter from the left edge, hop one node per layer with a little delay at
  each, and leave to the right. Nothing here is data: it is a picture of what the client does.
  Colours are read from the theme tokens, so the canvas follows the light/dark toggle.
-->
<script lang="ts">
	import { theme } from '#lib/motion/theme.svelte.ts';

	let canvas: HTMLCanvasElement;

	type Packet = { path: [number, number][]; t: number; speed: number };

	$effect(() => {
		// re-read colours whenever the theme flips
		void theme.value;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const css = getComputedStyle(document.documentElement);
		const accent = css.getPropertyValue('--accent').trim() || '#0f8a72';
		const ink = css.getPropertyValue('--ink-2').trim() || '#8a9aa2';
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

		let w = 0;
		let h = 0;
		let layers: [number, number][][] = [];
		const packets: Packet[] = [];

		function layout() {
			const dpr = Math.min(devicePixelRatio || 1, 2);
			w = canvas.clientWidth;
			h = canvas.clientHeight;
			canvas.width = w * dpr;
			canvas.height = h * dpr;
			ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
			const rows = Math.max(5, Math.round(h / 90));
			layers = [0.3, 0.5, 0.7].map((fx, li) =>
				Array.from({ length: rows }, (_, i) => [
					w * fx + Math.sin(i * 1.7 + li) * w * 0.025,
					(h * (i + 0.5)) / rows + Math.cos(i * 2.3 + li) * 12
				])
			);
		}

		const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

		function spawn() {
			const y0 = h * (0.15 + Math.random() * 0.7);
			const path: [number, number][] = [
				[-20, y0],
				...layers.map(pick),
				[w + 20, h * (0.15 + Math.random() * 0.7)]
			];
			packets.push({ path, t: 0, speed: 0.0018 + Math.random() * 0.0016 });
		}

		function pointAt(p: Packet): [number, number] {
			const segs = p.path.length - 1;
			const f = Math.min(p.t * segs, segs - 1e-6);
			const i = Math.floor(f);
			// ease within each hop so a packet seems to pause at every node
			const k = f - i;
			const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
			const [x0, y0] = p.path[i];
			const [x1, y1] = p.path[i + 1];
			return [x0 + (x1 - x0) * e, y0 + (y1 - y0) * e];
		}

		function draw() {
			ctx!.clearRect(0, 0, w, h);
			ctx!.fillStyle = ink;
			ctx!.globalAlpha = 0.35;
			for (const layer of layers)
				for (const [x, y] of layer) {
					ctx!.beginPath();
					ctx!.arc(x, y, 2.2, 0, Math.PI * 2);
					ctx!.fill();
				}
			for (const p of packets) {
				const [x, y] = pointAt(p);
				const fade = Math.min(1, p.t * 8, (1 - p.t) * 8);
				ctx!.globalAlpha = 0.12 * fade;
				ctx!.strokeStyle = accent;
				ctx!.lineWidth = 1;
				ctx!.beginPath();
				ctx!.moveTo(p.path[0][0], p.path[0][1]);
				for (let s = 1; s <= 24; s++) {
					const q = { ...p, t: (p.t * s) / 24 };
					const [qx, qy] = pointAt(q);
					ctx!.lineTo(qx, qy);
				}
				ctx!.stroke();
				ctx!.globalAlpha = 0.85 * fade;
				ctx!.fillStyle = accent;
				ctx!.beginPath();
				ctx!.arc(x, y, 3, 0, Math.PI * 2);
				ctx!.fill();
			}
			ctx!.globalAlpha = 1;
		}

		let raf = 0;
		let last = performance.now();
		function tick(now: number) {
			const dt = Math.min(64, now - last);
			last = now;
			if (packets.length < 9 && Math.random() < dt / 700) spawn();
			for (const p of packets) p.t += (p.speed * dt) / 16;
			for (let i = packets.length - 1; i >= 0; i--) if (packets[i].t >= 1) packets.splice(i, 1);
			draw();
			raf = requestAnimationFrame(tick);
		}

		layout();
		const ro = new ResizeObserver(() => {
			layout();
			if (reduced) draw();
		});
		ro.observe(canvas);
		if (reduced) {
			for (let i = 0; i < 6; i++) {
				spawn();
				packets[i].t = (i + 0.5) / 6;
			}
			draw();
		} else {
			raf = requestAnimationFrame(tick);
		}
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
		background: linear-gradient(180deg, var(--sky-0) 0%, var(--sky-1) 55%, var(--sky-2) 100%);
		transition: background 400ms ease;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
