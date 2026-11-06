// Benchmark results shown on /benchmarks. Session-level medians per arm, as printed by the
// bench analyser, plus one representative burst per arm for the staircase chart.
// Replace this file when a run completes; the page renders whatever is here.

export type Arm = 'D' | 'N0' | 'N1' | 'N2S';

export interface ArmResult {
	arm: Arm;
	label: string;
	sessions: number;
	bootFailed: number;
	dead: number;
	burstMs: number | null;
	burstCi: [number, number] | null;
	steadyP50: number | null;
	steadyP95: number | null;
	successPct: number | null;
	firstOkMs: number | null;
	failovers: number;
}

export interface BenchRun {
	region: string;
	asOf: string;
	status: 'partial' | 'complete';
	note: string;
	arms: ArmResult[];
	/** Completion time (ms after the burst starts) of each of the 10 burst reads, one session per arm. */
	burstStairs: Partial<Record<Arm, number[]>>;
	/** Calls with no answer by this time are cut off and drawn at it. */
	cutoffMs: number;
}

/** Medians per region: burst, steady p50, share of calls answered. */
export interface RegionRow {
	region: string;
	cells: Record<'D' | 'N0' | 'N1', [number, number, number] | null>;
}

/** One measured arm: burst, steady p50 and p95 (ms), calls answered (%). */
export interface Measured {
	label: string;
	burstMs: number;
	p50Ms: number;
	p95Ms: number;
	answeredPct: number;
	note?: string;
}

export const run: BenchRun = {
	region: 'europe-west1',
	asOf: '2026-11-06',
	status: 'complete',
	note: 'Six sessions per arm on publicnode and mevblocker. Sessions on flashbots are left out: it caps batches at 5, which the client measured here did not yet respect.',
	cutoffMs: 24000,
	arms: [
		{ arm: 'D', label: 'Direct fetch (not anonymous)', sessions: 6, bootFailed: 0, dead: 0, burstMs: 195, burstCi: [138, 247], steadyP50: 37, steadyP95: 59, successPct: 100, firstOkMs: 145, failovers: 0 },
		{ arm: 'N0', label: 'Stock anon-rpc, Nym worker', sessions: 6, bootFailed: 0, dead: 0, burstMs: 24002, burstCi: [19282, 24003], steadyP50: 1204, steadyP95: 7201, successPct: 96, firstOkMs: 22302, failovers: 0 },
		{ arm: 'N1', label: 'Atmos v1, Nym worker', sessions: 6, bootFailed: 0, dead: 0, burstMs: 2256, burstCi: [1992, 2539], steadyP50: 746, steadyP95: 1474, successPct: 100, firstOkMs: 15108, failovers: 3 },
		{ arm: 'N2S', label: 'Atmos v1 with a constant-rate schedule', sessions: 6, bootFailed: 0, dead: 0, burstMs: 6855, burstCi: [5575, 9733], steadyP50: 2178, steadyP95: 4033, successPct: 100, firstOkMs: 14023, failovers: 8 }
	],
	burstStairs: {
		D: [103, 103, 104, 104, 107, 107, 109, 110, 146, 201],
		N0: [21119, 23158, 24000, 24000, 24000, 24000, 24000, 24000, 24000, 24000],
		N1: [2271, 2271, 2271, 2271, 2271, 2271, 2271, 2271, 2271, 2272]
	}
};

/** Run 2 (atmos-run2), 6 sessions per arm per region, flashbots sessions excluded. */
export const regions: RegionRow[] = [
	{ region: 'europe-west1', cells: { D: [195, 37, 100], N0: [24000, 1200, 96], N1: [2260, 746, 100] } },
	{ region: 'us-east1', cells: { D: [326, 81, 100], N0: [18800, 1230, 100], N1: [3320, 826, 100] } },
	{ region: 'asia-south1', cells: { D: [662, 154, 100], N0: [24000, 2140, 93], N1: [3050, 1070, 99] } }
];

/** Verified reads in europe-west1, before (run 3) and after (run 6) the head clock and proof cache. */
export const verified: Measured[] = [
	{ label: 'Before (atmos-run3)', burstMs: 13600, p50Ms: 1770, p95Ms: 5900, answeredPct: 100 },
	{ label: 'After (atmos-run6)', burstMs: 3550, p50Ms: 0, p95Ms: 1430, answeredPct: 100, note: 'p50 is 0 ms because most steady calls are eth_blockNumber, answered from the verified head; verified reads alone are 0.9–1.4 s.' }
];

/** Atmos v1 in the browser harness (headless Chromium) and in the Node harness, europe-west1. */
export const harness: Measured[] = [
	{ label: 'Chromium (atmos-run5)', burstMs: 2830, p50Ms: 522, p95Ms: 746, answeredPct: 100 },
	{ label: 'Node harness (atmos-run5)', burstMs: 3360, p50Ms: 572, p95Ms: 759, answeredPct: 100 },
	{ label: 'Chromium, pinned hash and allowlist (atmos-run7)', burstMs: 2550, p50Ms: 570, p95Ms: 1450, answeredPct: 100 },
	{ label: 'Node harness, pinned hash and allowlist (atmos-run7)', burstMs: 3990, p50Ms: 656, p95Ms: 1740, answeredPct: 100 }
];

/** Optional client settings, europe-west1, 4 sessions each (atmos-run6). */
export const options: Measured[] = [
	{ label: 'Atmos v1, defaults', burstMs: 2610, p50Ms: 542, p95Ms: 918, answeredPct: 100 },
	{ label: 'Hedged reads', burstMs: 2450, p50Ms: 579, p95Ms: 1013, answeredPct: 100 },
	{ label: 'Route rotation every 2 minutes', burstMs: 2620, p50Ms: 631, p95Ms: 1077, answeredPct: 100 },
	{ label: 'More reply SURBs', burstMs: 2400, p50Ms: 616, p95Ms: 1126, answeredPct: 100 },
	{ label: '15 s exit connect timeout', burstMs: 2640, p50Ms: 687, p95Ms: 1074, answeredPct: 100 }
];

/** Observer accuracy (%) telling idle from busy 12 s windows of a host's outgoing traffic; 50 is chance. */
export const anonymity = [
	{ label: 'Shaping off', requests: 98.6, bytes: 98.6, beacon: 51.4 },
	{ label: 'Shaping on', requests: 52.1, bytes: 60.4, beacon: 50.0 }
];
