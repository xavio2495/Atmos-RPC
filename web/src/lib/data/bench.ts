// Benchmark results shown on /benchmarks. Session-level medians per arm, as printed by the
// bench analyser, plus one representative burst per arm for the staircase chart.
// Replace this file when a run completes; the page renders whatever is here.

export type Arm = 'D' | 'N0' | 'N1' | 'N1H' | 'N2V' | 'N2VH' | 'N2S';

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
	/** Completion time (ms after the burst starts) of each of the 10 burst reads, the median session per arm. */
	burstStairs: Partial<Record<Arm, number[]>>;
	/** Calls with no answer by this time are cut off and drawn at it. */
	cutoffMs: number;
}

/** Per region: burst, steady p50 (ms) and share of calls answered (%), per arm. */
export interface RegionRow {
	region: string;
	cells: Partial<Record<Arm, [number, number, number]>>;
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

/** Per method, p50 / p95 in ms: direct, Atmos v1 (Node harness), Atmos with verified reads. */
export interface ParityRow {
	region: string;
	method: string;
	direct: [number, number];
	atmos: [number, number];
	verified: [number, number];
}

/** The final run (atmos-final-zpgmf), europe-west1: every arm on one image, 4 sessions each. */
export const run: BenchRun = {
	region: 'europe-west1',
	asOf: '2026-11-06',
	status: 'complete',
	note: 'Four sessions per arm on publicnode and mevblocker, one image for every arm, with the arm order rotated per task.',
	cutoffMs: 24000,
	arms: [
		{ arm: 'D', label: 'Direct fetch (not anonymous)', sessions: 4, bootFailed: 0, dead: 0, burstMs: 185, burstCi: [104, 244], steadyP50: 36, steadyP95: 56, successPct: 100, firstOkMs: 122, failovers: 0 },
		{ arm: 'N0', label: 'Stock anon-rpc, Nym worker', sessions: 4, bootFailed: 0, dead: 1, burstMs: 17932, burstCi: [12040, 24001], steadyP50: 915, steadyP95: 3177, successPct: 100, firstOkMs: 15905, failovers: 0 },
		{ arm: 'N1', label: 'Atmos v1, browser harness', sessions: 4, bootFailed: 0, dead: 0, burstMs: 2705, burstCi: [2161, 3251], steadyP50: 538, steadyP95: 1043, successPct: 100, firstOkMs: 26708, failovers: 0 },
		{ arm: 'N1H', label: 'Atmos v1, Node harness', sessions: 4, bootFailed: 0, dead: 0, burstMs: 2707, burstCi: [1190, 2720], steadyP50: 554, steadyP95: 889, successPct: 100, firstOkMs: 19259, failovers: 0 },
		{ arm: 'N2V', label: 'Atmos with verified reads', sessions: 4, bootFailed: 0, dead: 0, burstMs: 2675, burstCi: [2002, 3984], steadyP50: 0, steadyP95: 1304, successPct: 100, firstOkMs: 36248, failovers: 0 },
		{ arm: 'N2VH', label: 'Verified reads, as the self-hosted endpoint runs them', sessions: 4, bootFailed: 0, dead: 0, burstMs: 2901, burstCi: [2525, 3846], steadyP50: 0, steadyP95: 1480, successPct: 100, firstOkMs: 29266, failovers: 1 },
		{ arm: 'N2S', label: 'Atmos with a constant-rate schedule', sessions: 4, bootFailed: 0, dead: 0, burstMs: 7669, burstCi: [6780, 8481], steadyP50: 2020, steadyP95: 2544, successPct: 100, firstOkMs: 16897, failovers: 0 }
	],
	burstStairs: {
		D: [165, 165, 166, 166, 166, 168, 170, 170, 172, 174],
		N0: [4807, 10310, 10783, 11360, 12298, 12397, 13823, 14065, 15226, 17134],
		N1: [2675, 2675, 2675, 2676, 2676, 2676, 2676, 2676, 2676, 2676]
	}
};

/** The final run in three regions (atmos-final: zpgmf, 5m8dl, bzqh9), 4 sessions per arm per region. */
export const regions: RegionRow[] = [
	{ region: 'europe-west1', cells: { D: [185, 36, 100], N0: [17932, 915, 100], N1: [2705, 538, 100], N1H: [2707, 554, 100], N2VH: [2901, 0, 100] } },
	{ region: 'us-east1', cells: { D: [271, 85, 100], N0: [14706, 709, 100], N1: [2679, 603, 100], N1H: [1496, 579, 100], N2VH: [3946, 0, 99] } },
	{ region: 'asia-south1', cells: { D: [596, 210, 100], N0: [21974, 1180, 100], N1: [3635, 841, 100], N1H: [2113, 874, 100], N2VH: [5786, 0, 100] } }
];

/** First answer after start, median per region (eu, us, asia), final run. */
export const firstAnswer = {
	stock: [15.9, 16.8, 32.8],
	atmos: [19.3, 35.9, 54.2],
	// The self-hosted configuration (Node harness, 10-minute rotation), arm N2VH.
	verified: [29.3, 52.2, 71.0]
};

/** Run 2 (atmos-run2), the earlier reference: 6 sessions per arm per region, flashbots sessions excluded. */
export const regionsRun2: RegionRow[] = [
	{ region: 'europe-west1', cells: { D: [195, 37, 100], N0: [24000, 1200, 96], N1: [2260, 746, 100] } },
	{ region: 'us-east1', cells: { D: [326, 81, 100], N0: [18800, 1230, 100], N1: [3320, 826, 100] } },
	{ region: 'asia-south1', cells: { D: [662, 154, 100], N0: [24000, 2140, 93], N1: [3050, 1070, 99] } }
];

/** Per method against direct RPC (atmos-parity: 4nmbb, 5ljlw, tw5n8), steady calls, 4 sessions per arm per region. */
export const parity: ParityRow[] = [
	{ region: 'europe-west1', method: 'eth_blockNumber', direct: [37, 64], atmos: [542, 1569], verified: [0, 1] },
	{ region: 'europe-west1', method: 'eth_getBalance', direct: [37, 57], atmos: [584, 1553], verified: [1165, 3894] },
	{ region: 'us-east1', method: 'eth_blockNumber', direct: [121, 152], atmos: [672, 2003], verified: [0, 1] },
	{ region: 'us-east1', method: 'eth_getBalance', direct: [124, 175], atmos: [674, 1645], verified: [1129, 3444] },
	{ region: 'asia-south1', method: 'eth_blockNumber', direct: [161, 270], atmos: [769, 2461], verified: [0, 1] },
	{ region: 'asia-south1', method: 'eth_getBalance', direct: [162, 271], atmos: [767, 2669], verified: [1681, 4856] }
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

/** Observer accuracy (%) telling idle from busy 12 s windows of a host's outgoing requests; 50 is chance. Replies not measured. */
export const anonymity = [
	{ label: 'Shaping off', requests: 98.6, bytes: 98.6, beacon: 51.4 },
	{ label: 'Shaping on', requests: 52.1, bytes: 60.4, beacon: 50.0 }
];
