import { createAtmosClient } from "../../client/atmos.js";
import { createVerifiedReader } from "../../client/verify.js";
import { createShaper } from "../../client/shape.js";

// Two independent mainnet beacon APIs; the first also serves the light client.
const BEACONS = ["https://ethereum-beacon-api.publicnode.com", "https://lodestar-mainnet.chainsafe.io"];
const PROOF_PROVIDERS = ["https://rpc.mevblocker.io", "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"];

// The light client's trust anchor: the caller's, or the finalized block root that both
// beacon APIs report, read through the client so it leaves over the mixnet too.
async function checkpointFor(opts, client) {
  if (opts.checkpoint) return opts.checkpoint;
  for (let i = 0; i < 3; i++) {
    const roots = await Promise.all(BEACONS.map((b) => client.fetch(b + "/eth/v1/beacon/headers/finalized").then((r) => r.json()).then((j) => j.data.root)));
    if (roots[0] === roots[1]) return roots[0];
    await new Promise((r) => setTimeout(r, 12_000));
  }
  throw new Error("beacon APIs disagree on the finalized root");
}

async function bootAtmos(opts, t0, out, bootstrapProvider, clientOpts = {}) {
  out.events = [];
  const log = (e) => out.events.push({ at: Math.round(performance.now() - t0), ...e });
  try {
    const client = await createAtmosClient({ bootstrapProvider: bootstrapProvider(), probeUrl: opts.url, log, ...clientOpts });
    return { client, log };
  } catch (e) {
    out.boot.error = String(e?.message ?? e).slice(0, 80);
    return {};
  }
}

// Arms for v2, given the shared session helpers.
export const v2Arms = ({ workload, bootstrapProvider }) => ({
  // v1 plus proof-checked reads; calls that can't be checked go plain and are counted.
  // `clientOpts` lets a variant reuse this arm, e.g. on another harness or with rotation.
  async N2V(opts, t0, out, clientOpts) {
    const { client, log } = await bootAtmos(opts, t0, out, bootstrapProvider, clientOpts);
    if (!client) return;
    let reader;
    try {
      const beaconGet = (path) => client.fetch(BEACONS[0] + path).then((r) => r.json());
      try {
        const checkpoint = await checkpointFor(opts, client);
        out.boot.checkpoint = checkpoint;
        reader = await createVerifiedReader({ request: client.request, beaconGet, checkpoint, providers: PROOF_PROVIDERS, log });
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
      // The reader's head clock would otherwise keep fetching through the closed client.
      reader?.close();
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
