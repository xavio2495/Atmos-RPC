import { createMPT } from "@ethereumjs/mpt";
import { RLP } from "@ethereumjs/rlp";
import { hexToBytes, bytesToHex } from "@ethereumjs/util";

// Blocks whose receipts stay cached once proven.
const MAX_BLOCKS = 32;

const quantity = (h) => {
  const s = BigInt(h).toString(16);
  return s === "0" ? new Uint8Array() : hexToBytes("0x" + (s.length % 2 ? "0" : "") + s);
};

// The consensus encoding of a receipt: type byte (if typed) then RLP of
// [status, cumulativeGasUsed, logsBloom, logs].
function encodeReceipt(r) {
  const body = RLP.encode([
    quantity(r.status),
    quantity(r.cumulativeGasUsed),
    hexToBytes(r.logsBloom),
    r.logs.map((l) => [hexToBytes(l.address), l.topics.map(hexToBytes), hexToBytes(l.data)]),
  ]);
  const type = Number(r.type);
  if (type === 0) return body;
  const out = new Uint8Array(body.length + 1);
  out[0] = type;
  out.set(body, 1);
  return out;
}

// Receipts proven by rebuilding the block's receipts trie and matching it to the
// receiptsRoot of a verified header. Derived fields (gasUsed, effectiveGasPrice, from,
// to, contractAddress) are the provider's; status, logs and inclusion are proven.
export function createReceiptChecker({ reader }) {
  const blocks = new Map();

  function blockReceipts(blockHash) {
    if (!blocks.has(blockHash)) {
      const proven = (async () => {
        const header = await reader.block(blockHash);
        const list = await reader.hint({ jsonrpc: "2.0", id: 8, method: "eth_getBlockReceipts", params: [blockHash] });
        const trie = await createMPT();
        for (const [i, r] of list.entries()) await trie.put(RLP.encode(i), encodeReceipt(r));
        if (bytesToHex(trie.root()) !== header.receiptsRoot.toLowerCase()) throw new Error("receipts do not match receiptsRoot");
        return new Map(list.map((r) => [r.transactionHash.toLowerCase(), r]));
      })();
      proven.catch(() => blocks.delete(blockHash));
      blocks.set(blockHash, proven);
      if (blocks.size > MAX_BLOCKS) blocks.delete(blocks.keys().next().value);
    }
    return blocks.get(blockHash);
  }

  return {
    // null means the provider reports no receipt yet; absence itself can't be proven.
    async receipt(txHash) {
      const hint = await reader.hint({ jsonrpc: "2.0", id: 9, method: "eth_getTransactionReceipt", params: [txHash] });
      if (!hint) return null;
      const r = (await blockReceipts(hint.blockHash.toLowerCase())).get(txHash.toLowerCase());
      if (!r) throw new Error("receipt not in its block");
      return r;
    },
  };
}
