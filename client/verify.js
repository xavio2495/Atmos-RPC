import { bls12_381 } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, concatBytes } from "@noble/hashes/utils";
import { createAccessListFollower } from "./bal.js";

// Fork epochs and versions from Electra on. A later fork changes the signing domain,
// so its heads fail to verify until it is added here. From Gloas the light-client
// header carries only the execution block hash, deeper in the block body.
export const MAINNET = {
  chainId: 1,
  genesisTime: 1606824023,
  genesisValidatorsRoot: "0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95",
  forks: [[364032, "0x05000000"], [411392, "0x06000000"]],
  gloasEpoch: Infinity,
};
export const SEPOLIA = {
  chainId: 11155111,
  genesisTime: 1655733600,
  genesisValidatorsRoot: "0xd8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078",
  forks: [[222464, "0x90000074"], [272640, "0x90000075"], [353024, "0x90000076"]],
  gloasEpoch: 353024,
};
// Generalized-index depth and leaf index of each light-client branch.
const BRANCH = {
  electra: { current: [6, 22], next: [6, 23], execution: [4, 9] },
  gloas: { current: [11, 897], next: [11, 898], execution: [11, 808] },
};
const SLOTS_PER_PERIOD = 8192;
const DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_";
const MAX_HEAD_AGE_S = 120;
const MAX_LIST_LAG = 2;
const HEAD_REFRESH_MS = 12_000;
const EMPTY_TRIE = "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421";
const EMPTY_CODE = "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const VERIFIABLE = new Set(["eth_getBalance", "eth_getTransactionCount", "eth_getStorageAt", "eth_getCode"]);
// How far back a header is reached by walking parent hashes from the verified head.
const MAX_HEADER_WALK = 64;
// The priority fee has no verifiable answer; a provider's suggestion is capped at this.
const MAX_TIP_WEI = 2_000_000_000n;

const hex = (b) => "0x" + bytesToHex(b);
const bytes = (h) => hexToBytes(h.startsWith("0x") ? h.slice(2) : h);
const concat = concatBytes;
const equal = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const quantity = (b) => "0x" + (b.length ? BigInt(hex(b)).toString(16) : "0");
// Minimal big-endian bytes of a quantity: zero is empty, as RLP wants.
const quantityBytes = (v) => {
  const s = BigInt(v).toString(16);
  return s === "0" ? new Uint8Array() : bytes(s.length % 2 ? "0" + s : s);
};

// SSZ hash_tree_root pieces for the few containers a light client needs.
const chunk = (b) => { const c = new Uint8Array(32); c.set(b); return c; };
// A little-endian integer of `width` bytes in a 32-byte chunk.
const le = (v, width) => {
  const c = new Uint8Array(32);
  for (let i = 0, n = BigInt(v); i < width; i++, n >>= 8n) c[i] = Number(n & 255n);
  return c;
};
const uint64 = (v) => le(v, 8);
const uint256 = (v) => le(v, 32);
function merkleize(chunks, limit = chunks.length) {
  let width = 1;
  while (width < limit) width *= 2;
  let layer = [...chunks];
  for (let zero = new Uint8Array(32); width > 1; width /= 2) {
    const next = [];
    for (let i = 0; i < width; i += 2) next.push(sha256(concat(layer[i] ?? zero, layer[i + 1] ?? zero)));
    layer = next;
    zero = sha256(concat(zero, zero));
  }
  return layer[0] ?? new Uint8Array(32);
}
const packed = (b) => Array.from({ length: Math.ceil(b.length / 32) }, (_, i) => chunk(b.slice(i * 32, i * 32 + 32)));

const beaconRoot = (h) =>
  merkleize([uint64(h.slot), uint64(h.proposer_index), bytes(h.parent_root), bytes(h.state_root), bytes(h.body_root)]);

const executionRoot = (e) => {
  const extra = bytes(e.extra_data);
  return merkleize([
    bytes(e.parent_hash), chunk(bytes(e.fee_recipient)), bytes(e.state_root), bytes(e.receipts_root),
    merkleize(packed(bytes(e.logs_bloom))), bytes(e.prev_randao), uint64(e.block_number), uint64(e.gas_limit),
    uint64(e.gas_used), uint64(e.timestamp), sha256(concat(merkleize(packed(extra), 1), uint64(extra.length))),
    uint256(e.base_fee_per_gas), bytes(e.block_hash), bytes(e.transactions_root), bytes(e.withdrawals_root),
    uint64(e.blob_gas_used), uint64(e.excess_blob_gas),
  ]);
};

const committeeRoot = (c) =>
  merkleize([
    merkleize(c.pubkeys.map((p) => sha256(concat(bytes(p), new Uint8Array(16))))),
    sha256(concat(bytes(c.aggregate_pubkey), new Uint8Array(16))),
  ]);

function branchOk(leaf, branch, depth, index, root) {
  if (branch.length !== depth) return false;
  let node = leaf;
  for (let i = 0; i < depth; i++) {
    node = (index >> i) & 1 ? sha256(concat(bytes(branch[i]), node)) : sha256(concat(node, bytes(branch[i])));
  }
  return equal(node, bytes(root));
}

const period = (slot) => Math.floor(Number(slot) / SLOTS_PER_PERIOD);
const layout = (chain, slot) => (Math.floor(Number(slot) / 32) >= chain.gloasEpoch ? BRANCH.gloas : BRANCH.electra);

// A committee's public keys, parsed once: a committee serves a whole period
// (~27 h), and parsing 512 keys costs far more than adding them.
const parsedKeys = new WeakMap();
const keysOf = (committee) => {
  let keys = parsedKeys.get(committee);
  if (!keys) parsedKeys.set(committee, (keys = committee.pubkeys.map((p) => bls12_381.G1.Point.fromHex(p.slice(2)))));
  return keys;
};

function syncSignatureOk(chain, committee, aggregate, header, signatureSlot) {
  const bits = bytes(aggregate.sync_committee_bits);
  const signers = keysOf(committee).filter((_, i) => (bits[i >> 3] >> (i & 7)) & 1);
  if (signers.length * 3 < committee.pubkeys.length * 2) return false;
  const epoch = Math.floor((Math.max(Number(signatureSlot), 1) - 1) / 32);
  const fork = chain.forks.findLast(([e]) => epoch >= e);
  if (!fork) return false;
  const forkDataRoot = merkleize([chunk(bytes(fork[1])), bytes(chain.genesisValidatorsRoot)]);
  const domain = concat(Uint8Array.of(7, 0, 0, 0), forkDataRoot.slice(0, 28));
  const signingRoot = merkleize([beaconRoot(header), domain]);
  const sigs = bls12_381.longSignatures;
  return sigs.verify(aggregate.sync_committee_signature.slice(2), sigs.hash(signingRoot, DST), sigs.aggregatePublicKeys(signers));
}

// RLP decoding, enough for trie nodes and account values.
function rlpDecode(b) {
  const [item, end] = rlpItem(b, 0);
  if (end !== b.length) throw new Error("rlp trailing bytes");
  return item;
}
function rlpItem(b, o) {
  const p = b[o];
  if (p < 0x80) return [b.slice(o, o + 1), o + 1];
  const long = (base) => { const n = p - base; let len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[o + 1 + i]; return [o + 1 + n, len]; };
  if (p < 0xb8) return [b.slice(o + 1, o + 1 + p - 0x80), o + 1 + p - 0x80];
  if (p < 0xc0) { const [s, len] = long(0xb7); return [b.slice(s, s + len), s + len]; }
  const [s, len] = p < 0xf8 ? [o + 1, p - 0xc0] : long(0xf7);
  const out = [];
  for (let i = s; i < s + len;) { const [x, n] = rlpItem(b, i); out.push(x); i = n; }
  return [out, s + len];
}

function rlpEncode(x) {
  const len = (n, base) => {
    if (n < 56) return Uint8Array.of(base + n);
    const l = quantityBytes(n);
    return concat(Uint8Array.of(base + 55 + l.length), l);
  };
  if (Array.isArray(x)) { const body = concat(...x.map(rlpEncode)); return concat(len(body.length, 0xc0), body); }
  return x.length === 1 && x[0] < 0x80 ? x : concat(len(x.length, 0x80), x);
}

// Header fields in hash order; trailing ones exist only from the fork that added them.
const HEADER_FIELDS = [
  ["parentHash"], ["sha3Uncles"], ["miner"], ["stateRoot"], ["transactionsRoot"], ["receiptsRoot"], ["logsBloom"],
  ["difficulty", 1], ["number", 1], ["gasLimit", 1], ["gasUsed", 1], ["timestamp", 1], ["extraData"], ["mixHash"], ["nonce"],
  ["baseFeePerGas", 1], ["withdrawalsRoot"], ["blobGasUsed", 1], ["excessBlobGas", 1], ["parentBeaconBlockRoot"],
  ["requestsHash"], ["blockAccessListHash"], ["slotNumber", 1],
];
const headerHash = (h) =>
  hex(keccak_256(rlpEncode(HEADER_FIELDS.filter(([k]) => h[k] !== undefined).map(([k, isQuantity]) => (isQuantity ? quantityBytes(h[k]) : bytes(h[k]))))));

const nibbles = (b) => Array.from(b).flatMap((x) => [x >> 4, x & 15]);

// Walks a Merkle-Patricia proof from `root` along keccak(key). Returns the leaf
// value, or null when the proof shows the key is absent.
function trieGet(root, key, proof) {
  const nodes = new Map(proof.map((n) => { const b = bytes(n); return [hex(keccak_256(b)), b]; }));
  const path = nibbles(keccak_256(key));
  let ref = bytes(root), at = 0;
  for (;;) {
    let node;
    if (Array.isArray(ref)) node = ref;
    else if (ref.length === 0) return null;
    else {
      const raw = ref.length === 32 ? nodes.get(hex(ref)) : ref;
      if (!raw) throw new Error("proof missing node");
      node = rlpDecode(raw);
    }
    if (node.length === 17) {
      if (at === path.length) return node[16].length ? node[16] : null;
      ref = node[path[at++]];
      continue;
    }
    if (node.length !== 2) throw new Error("bad trie node");
    const enc = nibbles(node[0]);
    const leaf = enc[0] >= 2;
    const part = enc.slice(enc[0] % 2 ? 1 : 2);
    if (!part.every((n, i) => path[at + i] === n)) return null;
    at += part.length;
    if (leaf) return at === path.length ? node[1] : null;
    ref = node[1];
  }
}

// Reads checked against a light-client header: the sync committee signs the head,
// the head commits to the execution state root, and eth_getProof proves each value
// under that root. `request(url, body)` is the JSON-RPC transport; `beaconGet(path)`
// returns parsed JSON from a beacon API. Anything that can't be checked is rejected.
// `split`: each address's proofs go to one provider chosen from the address's hash,
// falling back to the others only on failure, so no single provider sees every
// address the wallet reads.
// `accessLists`: providers serving EIP-7928 access lists. When given, proven accounts
// are kept current from every block's verified list, so repeat reads name nothing.
// `listRequest`: the transport for those lists (large replies), by default `request`.
export async function createVerifiedReader({ request, beaconGet, checkpoint, providers, chain = MAINNET, split = false, accessLists = null, listRequest = request, listParallel = 1, log = () => {} }) {
  // The first beacon request on a new route can fail in transit, which is not the
  // same as the checkpoint being unknown, so it is tried a few times.
  let boot, last;
  for (let attempt = 0; attempt < 3 && !boot; attempt++) {
    try {
      const r = await beaconGet(`/eth/v1/beacon/light_client/bootstrap/${checkpoint}`);
      boot = r?.data;
      last = boot ? undefined : String(r?.message ?? JSON.stringify(r)).slice(0, 120);
    } catch (e) {
      last = String(e?.message ?? e).slice(0, 120);
    }
    if (!boot) log({ event: "bootstrap-retry", attempt, reason: last });
  }
  if (!boot) throw new Error(`bootstrap not served for checkpoint (${last})`);
  if (hex(beaconRoot(boot.header.beacon)) !== checkpoint.toLowerCase()) throw new Error("bootstrap does not match checkpoint");
  if (!branchOk(committeeRoot(boot.current_sync_committee), boot.current_sync_committee_branch, ...layout(chain, boot.header.beacon.slot).current, boot.header.beacon.state_root)) {
    throw new Error("bad bootstrap committee");
  }
  const committees = new Map([[period(boot.header.beacon.slot), boot.current_sync_committee]]);
  let head = null, refreshing = null;
  const headers = new Map();

  // Move the committee forward one period at a time, each signed by the one before.
  async function committeeFor(p) {
    while (!committees.has(p)) {
      const known = Math.max(...committees.keys());
      if (known > p) throw new Error("period before checkpoint");
      const updates = await beaconGet(`/eth/v1/beacon/light_client/updates?start_period=${known}&count=1`);
      const u = (Array.isArray(updates) ? updates[0] : updates.data?.[0])?.data;
      if (!u || period(u.attested_header.beacon.slot) !== known || period(u.signature_slot) !== known) throw new Error("no update for period");
      if (!branchOk(committeeRoot(u.next_sync_committee), u.next_sync_committee_branch, ...layout(chain, u.attested_header.beacon.slot).next, u.attested_header.beacon.state_root)) throw new Error("bad next committee");
      if (!syncSignatureOk(chain, committees.get(known), u.sync_aggregate, u.attested_header.beacon, u.signature_slot)) throw new Error("bad update signature");
      committees.set(known + 1, u.next_sync_committee);
      log({ event: "committee", period: known + 1 });
    }
    return committees.get(p);
  }

  async function refreshHead() {
    const u = (await beaconGet("/eth/v1/beacon/light_client/optimistic_update")).data;
    const h = u.attested_header;
    const gloas = layout(chain, h.beacon.slot) === BRANCH.gloas;
    const leaf = gloas ? bytes(h.execution_block_hash) : executionRoot(h.execution);
    if (!branchOk(leaf, h.execution_branch, ...layout(chain, h.beacon.slot).execution, h.beacon.body_root)) throw new Error("bad execution branch");
    if (!syncSignatureOk(chain, await committeeFor(period(u.signature_slot)), u.sync_aggregate, h.beacon, u.signature_slot)) throw new Error("bad head signature");
    if (Date.now() / 1000 - (chain.genesisTime + Number(h.beacon.slot) * 12) > MAX_HEAD_AGE_S) throw new Error("stale head");
    // From Gloas the signed head names only a block hash; its header is fetched and must hash to it.
    const next = gloas
      ? await onProviders({ jsonrpc: "2.0", id: 3, method: "eth_getBlockByHash", params: [h.execution_block_hash, false] }, (b) => {
          const hash = h.execution_block_hash.toLowerCase();
          if (!b || headerHash(b) !== hash) throw new Error("header does not match block hash");
          headers.set(hash, { ...b, hash });
          return { number: Number(b.number), stateRoot: b.stateRoot, hash };
        })
      : { number: Number(h.execution.block_number), stateRoot: h.execution.state_root, hash: h.execution.block_hash };
    next.time = chain.genesisTime + Number(h.beacon.slot) * 12;
    if (!head || next.number > head.number) head = next;
  }
  const refreshOnce = () => {
    refreshing ??= refreshHead().finally(() => { refreshing = null; });
    return refreshing;
  };
  // Reads use the last verified head without waiting. It is refreshed on a fixed
  // clock rather than on demand, which keeps reads fast and makes the beacon
  // traffic independent of when the user is active. A rejected update is logged
  // and the last head kept; a read waits only once that head is too old to use.
  const currentHead = async () => {
    if (!head || Date.now() / 1000 - head.time > MAX_HEAD_AGE_S) await refreshOnce();
    return head;
  };
  // Open the connection to the first proof provider while the head is verified,
  // so the first reads don't pay for it.
  await Promise.all([currentHead(), request(providers[0], { jsonrpc: "2.0", id: 0, method: "eth_chainId", params: [] })]);
  const follower = accessLists?.length
    ? createAccessListFollower({
        headerAt: headerByNumber,
        fetchList: async (hash) => {
          // Behind one URL, some of a provider's backends lack the method; another try
          // usually reaches one that has it.
          for (let i = 0; ; i++) {
            try {
              return await onProviders({ jsonrpc: "2.0", id: 7, method: "eth_getBlockAccessList", params: [hash] }, (l) => l, accessLists, listRequest);
            } catch (e) {
              if (i === 3 || !/not available|does not exist|not found/i.test(String(e?.message))) throw e;
            }
          }
        },
        maxGap: MAX_HEADER_WALK,
        parallel: listParallel,
        log,
      })
    : null;
  // With access lists, reads are answered at the last block whose list has been applied,
  // while that is at most MAX_LIST_LAG blocks behind the verified head, so a held account
  // is never proven again and never waits for a list. Further behind, reads use the head.
  async function readHead() {
    const top = await currentHead();
    const at = follower?.size ? follower.block : -1;
    if (at < 0 || at >= top.number || top.number - at > MAX_LIST_LAG) return top;
    const h = await headerByNumber(at);
    return { number: at, stateRoot: h.stateRoot, hash: h.hash.toLowerCase(), time: top.time };
  }
  const followHead = async () => {
    // A list fetch replaced by a newer one on the bulk lane is skipped, not a failure.
    if (follower && head) await follower.follow(head.number).catch((e) => /superseded/.test(String(e?.message)) || log({ event: "access-list-failed", reason: String(e?.message ?? e).slice(0, 80) }));
  };
  // Every block's access list is fetched on the head clock, not when the wallet reads.
  const ticker = setInterval(() => {
    refreshOnce().then(followHead, (e) => log({ event: "head-rejected", reason: String(e?.message ?? e).slice(0, 80) }));
  }, HEAD_REFRESH_MS);
  ticker.unref?.();

  // One call, tried on each provider in turn; only this call moves on, not its batch.
  // A throttled provider gets one more try after a short pause before moving on.
  async function onProviders(body, check, order = providers, send = request) {
    let last;
    for (const url of order) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await send(url, body);
          if (r.error) throw new Error(r.error.message);
          return check(r.result);
        } catch (e) {
          last = e;
          log({ event: "verify-retry", url, method: body.method, reason: String(e?.message ?? e).slice(0, 80) });
          if (attempt || !/rate limit|too many requests|429/i.test(String(e?.message))) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    throw last;
  }

  // An account, chosen storage slots and (optionally) its code, each proven under
  // the state root of `head`. Slots are 32-byte hex keys; values come back as 32-byte hex.
  // Proven accounts for the current head's block, reused by every call at that block.
  let cacheBlock = -1;
  const cache = new Map();

  async function account(address, slots, head, withCode) {
    address = address.toLowerCase();
    const held = follower?.get(address, slots, withCode, head.number);
    if (held) return held;
    if (cacheBlock !== head.number) {
      cacheBlock = head.number;
      cache.clear();
    }
    const hit = cache.get(address);
    if (hit && slots.every((k) => k in hit.storage) && (!withCode || hit.code !== undefined)) return hit;
    const block = "0x" + head.number.toString(16);
    const proof = { jsonrpc: "2.0", id: 1, method: "eth_getProof", params: [address, slots, block] };
    const first = split ? keccak_256(bytes(address))[0] % providers.length : 0;
    const order = [...providers.slice(first), ...providers.slice(0, first)];
    // The code is requested with the proof rather than after it, and checked
    // against the proven code hash once both have arrived: one round trip, not two.
    const codeReply = withCode ? onProviders({ jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [address, block] }, (c) => c, order) : null;
    codeReply?.catch(() => {});
    const a = await onProviders(proof, (p) => {
      const value = trieGet(head.stateRoot, bytes(address), p.accountProof);
      const [nonce, balance, storageRoot, codeHash] = value ? rlpDecode(value) : [new Uint8Array(), new Uint8Array(), bytes(EMPTY_TRIE), bytes(EMPTY_CODE)];
      const storage = {};
      slots.forEach((slot, i) => {
        const sp = p.storageProof?.[i];
        if (!sp || BigInt(sp.key) !== BigInt(slot)) throw new Error("missing storage proof");
        const v = trieGet(hex(storageRoot), bytes(slot), sp.proof);
        storage[slot] = "0x" + hex(v ? rlpDecode(v) : new Uint8Array()).slice(2).padStart(64, "0");
      });
      return { exists: Boolean(value), nonce: quantity(nonce), balance: quantity(balance), storageRoot: hex(storageRoot), codeHash: hex(codeHash), storage };
    }, order);
    if (withCode) {
      const code = a.codeHash === EMPTY_CODE ? "0x" : await codeReply;
      if (hex(keccak_256(bytes(code))) !== a.codeHash) throw new Error("code does not match code hash");
      a.code = code;
    }
    if (hit && head.number === cacheBlock) {
      a.storage = { ...hit.storage, ...a.storage };
      a.code ??= hit.code;
    }
    if (head.number === cacheBlock) cache.set(address, a);
    follower?.seed(address, a, head.number);
    return a;
  }

  async function read(method, params) {
    const tag = method === "eth_getStorageAt" ? params[2] : params[1];
    if (tag !== undefined && tag !== "latest") throw new Error("not verifiable: block tag");
    const slots = method === "eth_getStorageAt" ? ["0x" + BigInt(params[1]).toString(16).padStart(64, "0")] : [];
    const a = await account(params[0], slots, await readHead(), method === "eth_getCode");
    if (method === "eth_getBalance") return a.balance;
    if (method === "eth_getTransactionCount") return a.nonce;
    if (method === "eth_getStorageAt") return a.storage[slots[0]];
    return a.code;
  }

  // A header is trusted when it hashes to a hash already trusted: the head's, or a
  // trusted child's parentHash.
  async function headerByHash(hash) {
    hash = hash.toLowerCase();
    if (!headers.has(hash)) {
      await onProviders({ jsonrpc: "2.0", id: 4, method: "eth_getBlockByHash", params: [hash, false] }, (b) => {
        if (!b || headerHash(b) !== hash) throw new Error("header does not match block hash");
        // The provider's own `hash` field is not part of what was hashed.
        headers.set(hash, { ...b, hash });
        if (headers.size > 4 * MAX_HEADER_WALK) headers.delete(headers.keys().next().value);
      });
    }
    return headers.get(hash);
  }

  async function headerByNumber(tag) {
    const top = await currentHead();
    const n = tag === "latest" || tag === undefined ? top.number : Number(tag);
    if (!(n <= top.number && top.number - n <= MAX_HEADER_WALK)) throw new Error("not verifiable: block outside the verified window");
    let b = await headerByHash(top.hash);
    while (Number(b.number) > n) b = await headerByHash(b.parentHash);
    return b;
  }

  async function findHeader(hash) {
    let b = await headerByHash((await currentHead()).hash);
    for (let i = 0; i <= MAX_HEADER_WALK; i++) {
      if (b.hash.toLowerCase() === hash.toLowerCase()) return b;
      b = await headerByHash(b.parentHash);
    }
    throw new Error("not verifiable: block outside the verified window");
  }

  async function tip() {
    const r = await onProviders({ jsonrpc: "2.0", id: 5, method: "eth_maxPriorityFeePerGas", params: [] }, (t) => BigInt(t));
    return r > MAX_TIP_WEI ? MAX_TIP_WEI : r;
  }

  async function verifiedRequest(url, body) {
    const reply = (result) => ({ jsonrpc: "2.0", id: body.id, result });
    const params = body.params ?? [];
    if (body.method === "eth_chainId") return reply("0x" + chain.chainId.toString(16));
    if (body.method === "eth_blockNumber") return reply("0x" + (await readHead()).number.toString(16));
    // Block objects carry verified header fields; their transaction list is the provider's.
    if (body.method === "eth_getBlockByNumber" && !params[1]) return reply(await headerByNumber(params[0]));
    if (body.method === "eth_getBlockByHash" && !params[1]) return reply(await findHeader(params[0]));
    if (body.method === "eth_maxPriorityFeePerGas") return reply("0x" + (await tip()).toString(16));
    if (body.method === "eth_gasPrice") {
      const base = BigInt((await headerByNumber("latest")).baseFeePerGas);
      return reply("0x" + (base + (await tip())).toString(16));
    }
    if (body.method === "eth_sendRawTransaction") {
      const r = await request(url, body);
      if (r.result !== undefined && r.result.toLowerCase() !== hex(keccak_256(bytes(params[0])))) throw new Error("tx hash mismatch");
      return r;
    }
    if (!VERIFIABLE.has(body.method)) throw new Error(`not verifiable: ${body.method}`);
    try {
      return reply(await read(body.method, params));
    } catch (e) {
      return { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: String(e?.message ?? e) } };
    }
  }

  return {
    close: () => clearInterval(ticker),
    // How many accounts the access lists keep current, and at which block.
    following: () => (follower ? { accounts: follower.size, block: follower.block } : null),
    request: verifiedRequest,
    head: readHead,
    header: headerByNumber,
    block: findHeader,
    account,
    // An unverified answer, for hints such as access lists that are checked later.
    hint: (body) => onProviders(body, (r) => r),
  };
}
