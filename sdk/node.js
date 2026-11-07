// Atmos in Node: the Nym worker runs in the Node harness (a V8 isolate), no browser.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AnonRpcWorker } from "../harness/node-harness/dist/host.js";
import { NYM_WORKER_LIMITS } from "../client/atmos.js";
import { createProvider } from "./provider.js";

const here = dirname(fileURLToPath(import.meta.url));

// The Nym worker is built for a browser: it needs WebAssembly room, a WebSocket and
// the browser platform pieces, all granted by the Node harness.
export class NymWorker extends AnonRpcWorker {
  constructor(init) {
    super({
      ...init,
      capabilities: { fetch: true, webSocket: true, web: true },
      limits: NYM_WORKER_LIMITS,
      bundleCacheDir: process.env.ATMOS_BUNDLE_CACHE ?? join(here, ".bundles"),
    });
  }
}

// createAtmos({ checkpoint, bal, shape, prefetch, log }) → EIP-1193 provider on Sepolia.
export const createAtmos = (options = {}) => createProvider({ Worker: NymWorker, ...options });
