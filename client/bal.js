import { RLP } from "@ethereumjs/rlp";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// Accounts kept current once proven; past this, the least recently used is dropped
// (and proven again, which names it to a provider, if it is read later).
const MAX_ACCOUNTS = 256;

const hex = (b) => "0x" + bytesToHex(b);
const bytes = (h) => hexToBytes(h.slice(2));
const quantity = (h) => "0x" + BigInt(h).toString(16);
const minimal = (h) => {
  const s = BigInt(h).toString(16);
  return s === "0" ? new Uint8Array() : hexToBytes(s.length % 2 ? "0" + s : s);
};
const word = (h) => "0x" + BigInt(h).toString(16).padStart(64, "0");
const last = (list) => list[list.length - 1];

// EIP-7928: keccak of the RLP block access list, from its JSON-RPC form.
export function accessListHash(list) {
  return hex(keccak_256(RLP.encode(list.map((a) => [
    bytes(a.address),
    a.storageChanges.map((s) => [minimal(s.key), s.changes.map((c) => [minimal(c.index), minimal(c.value)])]),
    a.storageReads.map(minimal),
    a.balanceChanges.map((c) => [minimal(c.index), minimal(c.value)]),
    a.nonceChanges.map((c) => [minimal(c.index), minimal(c.value)]),
    a.codeChanges.map((c) => [minimal(c.index), bytes(c.code)]),
  ]))));
}

// A working set of proven accounts kept current by every block's access list, so a
// read of a known account asks nothing that names it. Every block's list is the same
// request for everyone. `headerAt(n)` returns a verified header; `fetchList(hash)`
// returns that block's access list as JSON, which must hash to the header's commitment.
// Each account records the block its values hold at. A gap longer than `maxGap`
// blocks empties the set, since its headers can't be walked.
export function createAccessListFollower({ headerAt, fetchList, maxGap, log = () => {} }) {
  const accounts = new Map();
  let at = -1;
  let advancing = null;

  function apply(list, block) {
    for (const a of list) {
      const e = accounts.get(a.address.toLowerCase());
      if (!e || e.block >= block) continue;
      if (a.balanceChanges.length) e.balance = quantity(last(a.balanceChanges).value);
      if (a.nonceChanges.length) e.nonce = quantity(last(a.nonceChanges).value);
      if (a.codeChanges.length) {
        e.code = last(a.codeChanges).code;
        e.codeHash = hex(keccak_256(bytes(e.code)));
      }
      for (const s of a.storageChanges) {
        const key = word(s.key);
        if (key in e.storage) e.storage[key] = word(last(s.changes).value);
      }
      if (a.balanceChanges.length || a.nonceChanges.length || a.codeChanges.length || a.storageChanges.length) e.exists = true;
    }
    // An account not in the list is unchanged by the block.
    for (const e of accounts.values()) if (e.block < block) e.block = block;
  }

  async function advanceTo(n) {
    // Nothing held, or too far behind: start over at n without fetching anything.
    if (at < 0 || n - at > maxGap || accounts.size === 0) {
      if (accounts.size) log({ event: "access-lists-reset", from: at, to: n });
      accounts.clear();
      at = n;
      return;
    }
    while (at < n) {
      const header = await headerAt(at + 1);
      const list = await fetchList(header.hash);
      if (accessListHash(list) !== header.blockAccessListHash?.toLowerCase()) throw new Error("access list does not match header");
      apply(list, at + 1);
      at++;
    }
  }

  return {
    // Brings the set up to block n, one block at a time; concurrent callers share the work.
    async follow(n) {
      while (at < n) {
        advancing ??= advanceTo(n).finally(() => { advancing = null; });
        await advancing;
      }
    },
    holds: (address) => accounts.has(address),
    // The account as of block n if every requested part is held, else null.
    get(address, slots, withCode, n) {
      const e = accounts.get(address);
      if (!e || e.block !== n || !slots.every((k) => k in e.storage) || (withCode && e.code === undefined)) return null;
      accounts.delete(address);
      accounts.set(address, e);
      const { block, ...a } = e;
      return { ...a, storage: { ...a.storage } };
    },
    // A proof made at block n joins the set. Lists from blocks after n apply to it;
    // anything it already held is kept only if it holds at the same block.
    seed(address, a, n) {
      if (n < at) return;
      if (accounts.size === 0) at = n;
      const held = accounts.get(address);
      const same = held?.block === n;
      accounts.delete(address);
      accounts.set(address, { ...a, block: n, storage: { ...(same ? held.storage : {}), ...a.storage }, code: a.code ?? (same ? held.code : undefined) });
      if (accounts.size > MAX_ACCOUNTS) accounts.delete(accounts.keys().next().value);
    },
    get size() { return accounts.size; },
    get block() { return at; },
  };
}
