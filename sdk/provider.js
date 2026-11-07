import { startAtmos } from "./core.js";

const CHAIN_ID = "0xaa36a7"; // Sepolia

// An EIP-1193 provider over Atmos, for viem, ethers or wagmi. It reads and broadcasts;
// it holds no keys, so sign with a local account and send raw transactions.
const KEYLESS = new Set(["eth_accounts", "eth_requestAccounts", "eth_sendTransaction", "eth_sign", "personal_sign", "eth_signTypedData_v4"]);

export function createProvider(options) {
  const atmos = startAtmos({ log: () => {}, ...options });
  const listeners = new Map();
  const emit = (event, value) => listeners.get(event)?.forEach((f) => f(value));
  const rpcError = (code, message, data) => Object.assign(new Error(message), { code, ...(data !== undefined ? { data } : {}) });
  let id = 0;

  atmos.ready.then(
    () => emit("connect", { chainId: CHAIN_ID }),
    (e) => emit("disconnect", rpcError(4900, String(e?.message ?? e))),
  );

  return {
    isAtmos: true,
    ready: atmos.ready,
    status: atmos.status,
    async request({ method, params = [] }) {
      if (method === "eth_accounts") return [];
      if (KEYLESS.has(method)) throw rpcError(4200, `${method} needs a wallet: Atmos holds no keys`);
      const reply = await atmos.handle({ jsonrpc: "2.0", id: ++id, method, params });
      if (reply.error) throw rpcError(reply.error.code, reply.error.message, reply.error.data);
      return reply.result;
    },
    on(event, f) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(f);
      return this;
    },
    removeListener(event, f) {
      listeners.get(event)?.delete(f);
      return this;
    },
    close() {
      atmos.close();
      emit("disconnect", rpcError(4900, "closed"));
    },
  };
}
