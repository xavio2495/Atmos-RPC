// Arms whose worker runs in Node instead of in the page: Atmos v1 on the Atmos Node harness.
globalThis.window = globalThis;
const { ARMS } = await import("./page/dist/session.js");
const { AnonRpcWorker } = await import("../harness/node-harness/dist/host.js");

// The Nym worker is built for a browser: it needs WebAssembly room, a WebSocket and browser platform pieces.
class NymWorker extends AnonRpcWorker {
  constructor(init) {
    super({
      ...init,
      capabilities: { fetch: true, webSocket: true, web: true },
      limits: { memoryBytes: 1024 ** 3, deadlineMs: 60_000 },
    });
  }
}

ARMS.N1H = (opts, t0, out) => ARMS.N1(opts, t0, out, NymWorker);

export const NODE_ARMS = new Set(["N1H"]);
export const runInNode = (opts) => window.runSession(opts);
