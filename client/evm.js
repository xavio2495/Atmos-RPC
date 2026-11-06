import { createEVM } from "@ethereumjs/evm";
import { Common, Hardfork, Mainnet, Sepolia } from "@ethereumjs/common";
import { SimpleStateManager } from "@ethereumjs/statemanager";
import { createAccount, createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";

const CHAINS = { 1: Mainnet, 11155111: Sepolia };
// Execution forks paired in order with the verifier's consensus forks (Electra,
// Fulu, Gloas). Blob-parameter forks (bpo*) follow Osaka without a consensus fork.
const PAIRED = [Hardfork.Prague, Hardfork.Osaka, Hardfork.Amsterdam];
// EIP-7691's blob base fee update fraction, which later forks replace with their own.
const PRAGUE_BLOB_FRACTION = 5007716n;
const SECONDS_PER_EPOCH = 384;
// Each run that touches unproven state fetches it and runs again, at most this often.
const MAX_ROUNDS = 6;
const ZERO = "0x" + "0".repeat(64);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const big = (h) => (h === undefined || h === null ? undefined : BigInt(h));
const slotKey = (b) => "0x" + bytesToHex(b).slice(2).padStart(64, "0");

// EIP-4844's integer approximation of factor * e^(numerator / denominator).
function fakeExponential(factor, numerator, denominator) {
  let output = 0n;
  for (let i = 1n, acc = factor * denominator; acc > 0n; i++) {
    output += acc;
    acc = (acc * numerator) / (denominator * i);
  }
  return output / denominator;
}

// The execution rules in force at a verified header. They are picked by timestamp and
// must belong to the consensus fork the verifier signs under, so a fork this code
// doesn't know fails the call instead of running it under older rules.
function rulesFor(chain) {
  const known = CHAINS[chain.chainId];
  if (!known) throw new Error(`not verifiable: no execution rules for chain ${chain.chainId}`);
  // The library leaves Amsterdam unscheduled; the Gloas epoch dates it.
  const amsterdam = Number.isFinite(chain.gloasEpoch) ? String(chain.genesisTime + chain.gloasEpoch * SECONDS_PER_EPOCH) : null;
  const hardforks = known.hardforks.map((h) => (h.name === Hardfork.Amsterdam && amsterdam ? { ...h, timestamp: amsterdam } : h));
  const base = new Common({ chain: { ...known, hardforks } });
  const byFork = new Map();
  return (header) => {
    const timestamp = BigInt(header.timestamp);
    base.setHardforkBy({ blockNumber: BigInt(header.number), timestamp });
    const fork = base.hardfork();
    const epoch = Math.floor((Number(timestamp) - chain.genesisTime) / SECONDS_PER_EPOCH);
    const paired = PAIRED[chain.forks.findLastIndex(([e]) => epoch >= e)];
    if (fork !== paired && !(paired === Hardfork.Osaka && fork.startsWith("bpo"))) {
      throw new Error(`not verifiable: execution rules ${fork} do not match the chain's fork`);
    }
    if (!byFork.has(fork)) byFork.set(fork, base.copy());
    return byFork.get(fork);
  };
}

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
export function createExecutor({ reader, chain }) {
  const rules = rulesFor(chain);
  // BLOCKHASH answers from verified headers; outside the verified window the call fails.
  const blockchain = {
    getBlock: async (n) => {
      const { hash } = await reader.header(n);
      return { hash: () => hexToBytes(hash) };
    },
    putBlock: async () => {},
    shallowCopy: () => blockchain,
  };

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
    const common = rules(header);
    const fraction = [Hardfork.Prague, Hardfork.Osaka].includes(common.hardfork()) ? PRAGUE_BLOB_FRACTION : BigInt(common.param("blobGasPriceUpdateFraction"));
    const blobFee = fakeExponential(1n, BigInt(header.excessBlobGas), fraction);
    const evm = await createEVM({ common, stateManager: state, blockchain });
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
          getBlobGasPrice: () => blobFee,
        },
      },
    });
    return { result, missing: state.missing };
  }

  // Runs until no unproven state is touched. An access list from the provider seeds
  // the first round; it is only a hint, since every value used is proven.
  async function execute(tx, gasLimit) {
    const head = await reader.head();
    const header = await reader.header(head.number);
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
