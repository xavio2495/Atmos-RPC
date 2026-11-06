// A spring-driven 0..1 morph: 0 is an amorphous blob, 1 a settled panel. Everything visual
// (corner radii, opacity, scatter) derives from this one number. Low stiffness and moderate
// damping give a slow, heavy settle rather than a bouncy one.

import { Spring } from 'svelte/motion';

export function createMorph(initial = 0): Spring<number> {
	return new Spring(initial, { stiffness: 0.06, damping: 0.5 });
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** An 8-value border-radius: an off-centre blob at 0, the panel radius from ~0.85 on. */
export function blobRadius(resolve: number, resolvedRadiusPx = 24): string {
	const r = clamp01(resolve);
	if (r > 0.85) return `${resolvedRadiusPx}px`;
	const h = [60 - r * 44, 40 + r * 44, 30 + r * 40, 70 - r * 40];
	const v = [50 - r * 30, 60 - r * 30, 40 + r * 30, 50 + r * 30];
	return `${h[0]}% ${h[1]}% ${h[2]}% ${h[3]}% / ${v[0]}% ${v[1]}% ${v[2]}% ${v[3]}%`;
}
