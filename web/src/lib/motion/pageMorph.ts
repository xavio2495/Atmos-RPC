import { cubicOut } from 'svelte/easing';

// Route-to-route transition: the old page fades, drifts and blurs out while the new one
// sharpens in. Used as both in: and out: on a keyed wrapper so the two overlap.
export function pageMorph(_node: Element, { duration = 760 }: { duration?: number } = {}) {
	return {
		duration,
		easing: cubicOut,
		css: (t: number, u: number) =>
			`opacity:${t}; transform: translateY(${u * 14}px) scale(${1 - u * 0.02}); filter: blur(${u * 5}px);`
	};
}
