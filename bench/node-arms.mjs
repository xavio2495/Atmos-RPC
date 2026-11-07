// Arms whose worker runs in Node instead of in the page: Atmos v1 on the Atmos Node harness.
globalThis.window = globalThis;
const { ARMS, NYM_WORKER_LIMITS } = await import("./page/dist/session.js");
const { AnonRpcWorker } = await import("../harness/node-harness/dist/host.js");

// The Nym worker is built for a browser: it needs WebAssembly room, a WebSocket and browser platform pieces.
class NymWorker extends AnonRpcWorker {
  constructor(init) {
    super({
      ...init,
      capabilities: { fetch: true, webSocket: true, web: true },
      limits: NYM_WORKER_LIMITS,
    });
  }
}

ARMS.N1H = (opts, t0, out) => ARMS.N1(opts, t0, out, NymWorker);
// Verified reads configured as atmos-host runs them: the Node harness and 10-minute route rotation.
ARMS.N2VH = (opts, t0, out) => ARMS.N2V(opts, t0, out, { Worker: NymWorker, rotateMs: 600_000 });

export const NODE_ARMS = new Set(["N1H", "N2VH"]);
export const runInNode = (opts) => window.runSession(opts);
