// Benchmark results shown on /benchmarks. Session-level medians per arm, as printed by the
// bench analyser, plus one representative burst per arm for the staircase chart.
// Replace this file when a run completes; the page renders whatever is here.

export type Arm = 'D' | 'N0' | 'N1';

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
}

export const run: BenchRun = {
	region: 'europe-west1',
	asOf: '2026-11-06 09:33 UTC',
	status: 'partial',
	note: 'Runs still in progress: 3 sessions per arm so far, and no completed Atmos v1 session yet.',
	arms: [
		{
			arm: 'D',
			label: 'Direct fetch (not anonymous)',
			sessions: 3,
			bootFailed: 0,
			dead: 0,
			burstMs: 178,
			burstCi: [176, 207],
			steadyP50: 33,
			steadyP95: 48,
			successPct: 100,
			firstOkMs: 164,
			failovers: 0
		},
		{
			arm: 'N0',
			label: 'Stock anon-rpc, Nym worker',
			sessions: 3,
			bootFailed: 0,
			dead: 0,
			burstMs: 16711,
			burstCi: [15534, 17616],
			steadyP50: 1004,
			steadyP95: 5499,
			successPct: 100,
			firstOkMs: 15834,
			failovers: 0
		},
		{
			arm: 'N1',
			label: 'Atmos v1, Nym worker',
			sessions: 0,
			bootFailed: 0,
			dead: 0,
			burstMs: null,
			burstCi: null,
			steadyP50: null,
			steadyP95: null,
			successPct: null,
			firstOkMs: null,
			failovers: 0
		}
	],
	burstStairs: {
		D: [160, 162, 164, 166, 167, 167, 168, 170, 171, 176],
		N0: [5984, 6825, 7905, 8532, 9491, 10843, 11355, 12571, 13351, 17615]
	}
};
