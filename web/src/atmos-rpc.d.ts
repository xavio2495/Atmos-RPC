// The SDK is plain JavaScript in the repository's sdk/ folder (aliased in vite.config.ts).
declare module 'atmos-rpc' {
	export function createAtmos(options?: {
		checkpoint?: string;
		bal?: boolean;
		shape?: boolean;
		prefetch?: boolean;
		log?: (event: Record<string, unknown>) => void;
	}): unknown;
}
