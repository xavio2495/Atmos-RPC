// The isolation boundary on V8: the worker bundle runs in a separate V8 isolate
// (isolated-vm), with the same host interface and prelude as the QuickJS one.
//
// Why a second engine. QuickJS has no WebAssembly, so a worker whose network
// client is compiled to WASM (the Nym worker) cannot run there at all. A V8
// isolate has WebAssembly as an ECMAScript-adjacent intrinsic, runs guest JS at
// V8 speed rather than interpreter speed, and keeps the property that matters:
// it is a separate heap with nothing in it. No process, no require, no timers,
// no fetch — the same empty starting point, so the prelude builds the same
// platform and every capability is still a host grant.
//
// What crosses the boundary is copies, as before: strings, numbers and
// ArrayBuffers. Host functions are isolated-vm Callbacks, which are functions
// of the guest's own realm, so `fn.constructor` is the guest's Function.
//
// Two differences from QuickJS, both handled here:
//   * A Callback cannot hand a promise back, so a guest request is parked
//     under an id in the guest and settled later by the host calling in.
//   * Limits come from V8: a per-entry `timeout` instead of an interrupt
//     handler, `memoryLimit` instead of a QuickJS heap cap, and V8's own stack
//     guard. Their errors are renamed to the three kinds the host reports.

import ivm from "isolated-vm";
import PRELUDE from "./prelude.guest.js";
import type { HostReply, IsolateCapabilities, IsolateOptions } from "./isolate.js";

const DEFAULT_MEMORY_BYTES = 64 * 1024 * 1024;
const DEFAULT_DEADLINE_MS = 5_000;

// Installed before the prelude: turns the raw callbacks into the four
// functions the prelude expects, with requests parked until the host settles
// them. `__host_settle` is taken by reference and then deleted, like the
// prelude's abort hook, so guest code cannot forge a settlement.
const SHIM = `(() => {
  "use strict";
  const send = __raw_send, req = __raw_req, rnd = __raw_random, url = __raw_url;
  delete globalThis.__raw_send; delete globalThis.__raw_req;
  delete globalThis.__raw_random; delete globalThis.__raw_url;
  const parked = new Map();
  let next = 1;
  globalThis.__host_send = (m, j, b) => { send(m, j, b || null); };
  globalThis.__host_request = (m, j, b) => new Promise((resolve, reject) => {
    const id = next++;
    parked.set(id, [resolve, reject]);
    req(id, m, j, b || null);
  });
  globalThis.__host_random = (n) => rnd(n);
  globalThis.__host_url = (i, b) => url(i, b === undefined ? null : b);
  globalThis.__host_settle = (id, ok, json, bytes, name, message, code) => {
    const p = parked.get(id);
    if (!p) return;
    parked.delete(id);
    if (ok) return p[0]([json, bytes]);
    const e = new Error(message);
    if (name) e.name = name;
    if (code) e.code = code;
    p[1](e);
  };
})();`;

/** Rename V8's limit errors to the kinds the host and its tests expect. */
function limitError(e: unknown): Error {
  const msg = String((e as Error)?.message ?? e);
  if (/timed out/i.test(msg)) return new Error(`interrupted: guest ran past its deadline (${msg})`);
  if (/call stack/i.test(msg)) return new Error(`stack overflow (${msg})`);
  if (/allocation failed|memory limit|out of memory/i.test(msg)) return new Error(`out of memory (${msg})`);
  return e instanceof Error ? e : new Error(msg);
}

const copy = (u: Uint8Array) => new ivm.ExternalCopy(u.slice().buffer).copyInto({ release: true });

export class Isolate {
  #iso: ivm.Isolate;
  #ctx: ivm.Context;
  #opts: IsolateOptions;
  #deadlineMs: number;
  #settle?: ivm.Reference<(...a: unknown[]) => void>;
  #onCallAbort?: ivm.Reference<(id: number) => void>;
  #disposed = false;

  private constructor(iso: ivm.Isolate, ctx: ivm.Context, opts: IsolateOptions) {
    this.#iso = iso;
    this.#ctx = ctx;
    this.#opts = opts;
    this.#deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  static async create(caps: IsolateCapabilities, config: unknown, opts: IsolateOptions): Promise<Isolate> {
    const iso = new ivm.Isolate({ memoryLimit: Math.max(8, Math.ceil((opts.memoryBytes ?? DEFAULT_MEMORY_BYTES) / 2 ** 20)) });
    const ctx = await iso.createContext();
    const self = new Isolate(iso, ctx, opts);
    try {
      self.#install(caps, config);
      return self;
    } catch (e) {
      self.dispose();
      throw e;
    }
  }

  #install(caps: IsolateCapabilities, config: unknown): void {
    const g = this.#ctx.global;
    const bytesOf = (b: unknown) => (b instanceof ArrayBuffer ? new Uint8Array(b) : undefined);
    const jsonOf = (j: unknown) => {
      if (typeof j !== "string") return undefined;
      try {
        return JSON.parse(j);
      } catch {
        return undefined;
      }
    };

    g.setSync("__raw_send", new ivm.Callback((m: string, j: unknown, b: unknown) => {
      try {
        this.#opts.onSend(String(m), jsonOf(j), bytesOf(b));
      } catch (e) {
        this.#opts.onInternalError(e);
      }
    }));

    g.setSync("__raw_req", new ivm.Callback((id: number, m: string, j: unknown, b: unknown) => {
      this.#opts.onRequest(String(m), jsonOf(j), bytesOf(b)).then(
        (reply: HostReply) => this.#call(this.#settle, [
          id,
          true,
          reply.value === undefined ? null : JSON.stringify(reply.value),
          reply.bytes ? copy(reply.bytes) : null,
        ]),
        (err: unknown) => {
          const e = err as { name?: string; message?: string; code?: unknown };
          this.#call(this.#settle, [id, false, null, null, e?.name ?? null, String(e?.message ?? err), typeof e?.code === "string" ? e.code : null]);
        },
      );
    }));

    g.setSync("__raw_random", new ivm.Callback((n: number) => copy(this.#opts.random(Math.max(0, Math.min(65536, n | 0))))));

    g.setSync("__raw_url", new ivm.Callback((input: string, base: unknown) => {
      try {
        const u = typeof base === "string" ? new URL(String(input), base) : new URL(String(input));
        const { href, protocol, username, password, host, hostname, port, pathname, search, hash, origin } = u;
        return JSON.stringify({ href, protocol, username, password, host, hostname, port, pathname, search, hash, origin });
      } catch {
        return null;
      }
    }));

    g.setSync("__host_capabilities_json", JSON.stringify({ ...caps, config: config ?? undefined }));
    this.#eval(`globalThis.__host_capabilities = JSON.parse(__host_capabilities_json); delete globalThis.__host_capabilities_json;`, "anon-rpc:caps");
    this.#eval(SHIM, "anon-rpc:shim");
    this.#settle = g.getSync("__host_settle", { reference: true }) as ivm.Reference<(...a: unknown[]) => void>;
    this.#eval(`delete globalThis.__host_settle;`, "anon-rpc:shim-seal");
    this.#eval(PRELUDE, "anon-rpc:prelude");

    // As in the QuickJS isolate: keep the abort hook by reference, then remove
    // it from the guest's global so a worker cannot replace it.
    const hook = g.getSync("__onCallAbort", { reference: true }) as ivm.Reference<(id: number) => void>;
    this.#onCallAbort = hook.typeof === "function" ? hook : undefined;
    this.#eval(`delete globalThis.__onCallAbort;`, "anon-rpc:seal");
  }

  /* --- entering the guest ------------------------------------------------ */

  runBundle(source: string, filename: string): void {
    this.#eval(source, filename);
  }

  abortCall(id: number): void {
    if (this.#disposed || !this.#onCallAbort) return;
    this.#call(this.#onCallAbort, [id]);
  }

  #eval(code: string, filename: string): void {
    try {
      this.#ctx.evalSync(code, { filename, timeout: this.#deadlineMs });
    } catch (e) {
      throw limitError(e);
    }
  }

  /**
   * Call into the guest from a host event (a settled request, an abort). The
   * deadline covers the call and the microtasks it releases. A failure here has
   * no guest frame to land in, so it is reported as a worker failure.
   */
  #call(ref: ivm.Reference<(...a: never[]) => unknown> | undefined, args: unknown[]): void {
    if (this.#disposed || !ref) return;
    try {
      ref.applySync(undefined, args as never[], { timeout: this.#deadlineMs });
    } catch (e) {
      if (!this.#disposed) this.#opts.onInternalError(limitError(e));
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#settle?.release();
      this.#onCallAbort?.release();
      this.#ctx.release();
      if (!this.#iso.isDisposed) this.#iso.dispose();
    } catch (e) {
      this.#opts.onInternalError(e);
    }
  }
}
