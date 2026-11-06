import { createEVM } from "@ethereumjs/evm";
import { Common, Hardfork, Mainnet, Sepolia } from "@ethereumjs/common";
import { SimpleStateManager } from "@ethereumjs/statemanager";
import { createAccount, createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";

// Execution rules per chain: Sepolia runs Amsterdam, mainnet Osaka.
const RULES = { 1: [Mainnet, Hardfork.Osaka], 11155111: [Sepolia, Hardfork.Amsterdam] };
// Each run that touches unproven state fetches it and runs again, at most this often.
const MAX_ROUNDS = 6;
const ZERO = "0x" + "0".repeat(64);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const big = (h) => (h === undefined || h === null ? undefined : BigInt(h));
const slotKey = (b) => "0x" + bytesToHex(b).slice(2).padStart(64, "0");

// A state manager over proven data only. Reading anything not yet proven is
// recorded and answered as empty, and the call is then re-run with it loaded.
class ProvenState extends SimpleStateManager {
  constructor(known) {
    super();
    this.known = known;
    this.missing = new Map();
  }
  #need(address, slot) {
    if (!this.missing.has(address)) this.missing.set(address, new Set());
    if (slot) this.missing.get(address).add(slot);
  }
  #proven(address) {
    if (!this.known.has(address.toString())) this.#need(address.toString());
  }
  async getAccount(address) {
    this.#proven(address);
    return super.getAccount(address);
  }
  async getCode(address) {
    this.#proven(address);
    return super.getCode(address);
  }
  async getStorage(address, key) {
    const a = this.known.get(address.toString());
    if (!a || !(slotKey(key) in a.storage)) this.#need(address.toString(), slotKey(key));
    return super.getStorage(address, key);
  }
}

// eth_call and eth_estimateGas executed locally against state proven by `reader`
// (from createVerifiedReader) at the verified head.
export function createExecutor({ reader, chainId }) {
  const [chain, hardfork] = RULES[chainId];
  const common = new Common({ chain, hardfork });

  async function load(known, wanted, head) {
    await Promise.all([...wanted].map(async ([address, slots]) => {
      const have = known.get(address);
      const need = [...slots].filter((s) => !have || !(s in have.storage));
      if (have && need.length === 0) return;
      const a = await reader.account(address, need, head, !have);
      known.set(address, have ? { ...have, storage: { ...have.storage, ...a.storage } } : a);
    }));
  }

  async function run(tx, gasLimit, header, known) {
    const state = new ProvenState(known);
    for (const [address, a] of known) {
      if (!a.exists) continue;
      const addr = createAddressFromString(address);
      await state.putAccount(addr, createAccount({ nonce: BigInt(a.nonce), balance: BigInt(a.balance) }));
      if (a.code !== "0x") await state.putCode(addr, hexToBytes(a.code));
      for (const [slot, value] of Object.entries(a.storage)) {
        if (value !== ZERO) await state.putStorage(addr, hexToBytes(slot), hexToBytes(value));
      }
    }
    const evm = await createEVM({ common, stateManager: state });
    const caller = createAddressFromString(tx.from ?? ZERO_ADDRESS);
    const result = await evm.runCall({
      caller,
      origin: caller,
      to: tx.to ? createAddressFromString(tx.to) : undefined,
      data: hexToBytes(tx.data ?? tx.input ?? "0x"),
      value: big(tx.value) ?? 0n,
      gasLimit,
      gasPrice: 0n,
      skipBalance: true,
      block: {
        header: {
          number: BigInt(header.number),
          coinbase: createAddressFromString(header.miner),
          timestamp: BigInt(header.timestamp),
          difficulty: 0n,
          prevRandao: hexToBytes(header.mixHash),
          gasLimit: BigInt(header.gasLimit),
          baseFeePerGas: big(header.baseFeePerGas),
          slotNumber: big(header.slotNumber),
          getBlobGasPrice: () => 1n,
        },
      },
    });
    return { result, missing: state.missing };
  }

  // Runs until no unproven state is touched. An access list from the provider seeds
  // the first round; it is only a hint, since every value used is proven.
  async function execute(tx, gasLimit) {
    const head = await reader.head();
    const header = await reader.header("latest");
    const block = "0x" + head.number.toString(16);
    const known = new Map();
    const wanted = new Map();
    const want = (address, slot) => {
      address = address.toLowerCase();
      if (!wanted.has(address)) wanted.set(address, new Set());
      if (slot) wanted.get(address).add(slot);
    };
    // The EVM always reads the caller, which defaults to the zero address.
    want(tx.from ?? ZERO_ADDRESS);
    if (tx.to) want(tx.to);
    want(header.miner);
    // The accounts known up front are proven while the access-list hint is in
    // flight, so the hint's round trip overlaps theirs.
    const upfront = new Map([...wanted].map(([a, s]) => [a, new Set(s)]));
    const [hint] = await Promise.all([
      reader.hint({ jsonrpc: "2.0", id: 6, method: "eth_createAccessList", params: [tx, block] }).catch(() => null),
      load(known, upfront, head),
    ]);
    for (const e of hint?.accessList ?? []) {
      want(e.address);
      for (const k of e.storageKeys) want(e.address, "0x" + k.slice(2).padStart(64, "0"));
    }
    for (let round = 0; round < MAX_ROUNDS; round++) {
      await load(known, wanted, head);
      const { result, missing } = await run(tx, gasLimit ?? BigInt(header.gasLimit), header, known);
      if (missing.size === 0) return result;
      for (const [address, slots] of missing) {
        want(address);
        for (const s of slots) want(address, s);
      }
    }
    throw new Error("call touches too much state to prove");
  }

  return {
    async call(tx) {
      const r = await execute(tx, big(tx.gas));
      const out = bytesToHex(r.execResult.returnValue);
      if (r.execResult.exceptionError) {
        const err = new Error("execution reverted");
        err.code = 3;
        err.data = out;
        throw err;
      }
      return out;
    },
    // Proves only that the call succeeds against the proven state. The gas amount is the
    // provider's: the local fork rules aren't known to match the chain's gas schedule.
    async estimateGas(tx, estimate) {
      const r = await execute(tx);
      if (r.execResult.exceptionError) throw new Error("call reverts in the proven state");
      return estimate;
    },
  };
}
