import { createAtmosClient } from "../../client/atmos.js";
import { createVerifiedReader } from "../../client/verify.js";
import { createShaper } from "../../client/shape.js";

const BEACON = "https://ethereum-beacon-api.publicnode.com";
// Finalized mainnet block root at slot 15594784, the light client's trust anchor.
const CHECKPOINT = "0x4f9c06cba2f0413722b917774787fd05a0fd28bfaec7d5a9d209b10028021092";
const PROOF_PROVIDERS = ["https://rpc.mevblocker.io", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"];

async function bootAtmos(opts, t0, out, bootstrapProvider) {
  out.events = [];
  const log = (e) => out.events.push({ at: Math.round(performance.now() - t0), ...e });
  try {
    const client = await createAtmosClient({ bootstrapProvider: bootstrapProvider(), probeUrl: opts.url, log });
    return { client, log };
  } catch (e) {
    out.boot.error = String(e?.message ?? e).slice(0, 80);
    return {};
  }
}

// Arms for v2, given the shared session helpers.
export const v2Arms = ({ workload, bootstrapProvider }) => ({
  // v1 plus proof-checked reads; calls that can't be checked go plain and are counted.
  async N2V(opts, t0, out) {
    const { client, log } = await bootAtmos(opts, t0, out, bootstrapProvider);
    if (!client) return;
    try {
      const beaconGet = (path) => client.fetch(BEACON + path).then((r) => r.json());
      let reader;
      try {
        reader = await createVerifiedReader({ request: client.request, beaconGet, checkpoint: CHECKPOINT, providers: PROOF_PROVIDERS, log });
      } catch (e) {
        out.boot.error = "verifier: " + String(e?.message ?? e).slice(0, 70);
        return;
      }
      out.boot.readyMs = Math.round(performance.now() - t0);
      out.unverified = 0;
      const send = (url, body) => reader.request(url, body).catch((e) => {
        if (!String(e?.message).startsWith("not verifiable")) throw e;
        out.unverified++;
        return client.request(url, body);
      });
      await workload(send, opts.url, opts.minutes, opts.rawTx, t0, out);
    } finally {
      client.close();
    }
  },
  // v1 behind the constant-rate schedule.
  async N2S(opts, t0, out) {
    const { client } = await bootAtmos(opts, t0, out, bootstrapProvider);
    if (!client) return;
    out.boot.readyMs = Math.round(performance.now() - t0);
    const shaper = createShaper({ request: client.request });
    try {
      await workload(shaper.request, opts.url, opts.minutes, opts.rawTx, t0, out);
    } finally {
      shaper.close();
      client.close();
    }
  },
});
