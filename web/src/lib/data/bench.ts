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
	cells: Record<'D' | 'N0' | 'N1' | 'N2S' | 'N2V', [number, number, number] | null>;
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

/** Three regions; the verified-read arm comes from a separate run with 4 sessions per arm. */
export const regions: RegionRow[] = [
	{ region: 'europe-west1', cells: { D: [195, 37, 100], N0: [24000, 1200, 96], N1: [2260, 746, 100], N2S: [6900, 2180, 100], N2V: [13600, 1800, 100] } },
	{ region: 'us-east1', cells: { D: [326, 81, 100], N0: [18800, 1230, 100], N1: [3320, 826, 100], N2S: [7400, 2430, 100], N2V: [5800, 1700, 100] } },
	{ region: 'asia-south1', cells: { D: [662, 154, 100], N0: [24000, 2140, 93], N1: [3050, 1070, 99], N2S: [7800, 2370, 100], N2V: [24000, 2300, 83] } }
];
