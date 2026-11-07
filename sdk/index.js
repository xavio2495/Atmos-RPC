// Atmos in the browser: the Nym worker runs in anon-rpc's sandboxed browser harness.
import { createProvider } from "./provider.js";

export { NYM_SPECIFIER } from "../client/atmos.js";

// createAtmos({ checkpoint, bal, shape, prefetch, log }) → EIP-1193 provider on Sepolia.
export const createAtmos = (options = {}) => createProvider(options);
