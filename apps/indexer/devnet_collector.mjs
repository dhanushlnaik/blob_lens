// Lightweight Glamsterdam devnet collector.
// Pulls per-block blob + gas + tx-type stats from the devnet RPC into the
// ISOLATED `glamsterdam.block_stats` table. Never touches mainnet tables.
//
// Reorg safety: devnets reorg frequently, and this is a forward-only poller that
// fetches blocks by NUMBER and never revisits a height. If it polled a height
// during a reorg it would capture the losing fork's block and keep it forever
// (that is how block 84343 ended up with orphaned 201-tx data). To avoid that we
// only index up to the FINALIZED head by default — finalized blocks can never
// reorg, so stored data is always canonical. Set ALLOW_UNFINALIZED=1 to index to
// the live head instead (not recommended: near-head blocks may later reorg).
//
// Table version = Date.now() per run (ReplacingMergeTree(version) keeps the newest
// insert), so re-running over a past range (START=0) OVERWRITES any stale rows —
// that is also how you heal blocks that were corrupted before this fix.
//
// Usage:
//   RPC=https://rpc.plataberget.ethpandaops.io/ \
//   CH=http://ba-data:8123 CH_USER=blob_lens CH_PASS=changeme \
//   START=0 END=head BATCH=50 node apps/indexer/devnet_collector.mjs
//
//   ALLOW_UNFINALIZED=1   index to the live head instead of the finalized head
//   WITH_HASHES=1         also write block_hash + parent_hash (requires the two
//                         columns to exist — see ALTER TABLE in the fix notes)

const RPC = process.env.RPC || 'https://rpc.plataberget.ethpandaops.io/';
const CH = process.env.CH || 'http://ba-data:8123';
const CH_USER = process.env.CH_USER || 'blob_lens';
const CH_PASS = process.env.CH_PASS || 'changeme';
const BATCH = Number(process.env.BATCH || 40);
const DELAY_MS = Number(process.env.DELAY_MS || 250);
const ALLOW_UNFINALIZED = process.env.ALLOW_UNFINALIZED === '1';
const WITH_HASHES = process.env.WITH_HASHES === '1';
const BLOB_GAS_PER_BLOB = 131072;
const version = Date.now();

const auth = 'Basic ' + Buffer.from(`${CH_USER}:${CH_PASS}`).toString('base64');
const hexN = (h) => (h == null ? 0 : Number(BigInt(h)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resilient RPC: retries with backoff, tolerates non-JSON error pages (429/5xx).
async function rpc(method, params, attempt = 0) {
  try {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); }
    catch { throw new Error(`non-JSON (${r.status}): ${text.slice(0, 80)}`); }
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
    return j.result;
  } catch (e) {
    if (attempt >= 5) throw e;
    await sleep(500 * 2 ** attempt); // 0.5s,1s,2s,4s,8s
    return rpc(method, params, attempt + 1);
  }
}

async function chInsert(rows) {
  if (!rows.length) return;
  const body = rows.map((r) => JSON.stringify(r)).join('\n');
  const res = await fetch(`${CH}/?query=${encodeURIComponent('INSERT INTO glamsterdam.block_stats FORMAT JSONEachRow')}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-ndjson' },
    body,
  });
  if (!res.ok) throw new Error(`CH insert failed: ${res.status} ${await res.text()}`);
}

function blockToRow(b) {
  const txs = b.transactions || [];
  const t = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const tx of txs) {
    const ty = hexN(tx.type);
    if (t[ty] === undefined) t[ty] = 0;
    t[ty] += 1;
  }
  const blobGasUsed = hexN(b.blobGasUsed);
  const gasUsed = hexN(b.gasUsed);
  const gasLimit = hexN(b.gasLimit);
  const row = {
    block_number: hexN(b.number),
    block_timestamp: hexN(b.timestamp),
    base_fee_per_gas: hexN(b.baseFeePerGas),
    gas_used: gasUsed,
    gas_limit: gasLimit,
    gas_util: gasLimit ? gasUsed / gasLimit : 0,
    blob_gas_used: blobGasUsed,
    excess_blob_gas: hexN(b.excessBlobGas),
    blob_count: Math.round(blobGasUsed / BLOB_GAS_PER_BLOB),
    tx_count: txs.length,
    tx_type0: t[0], tx_type1: t[1], tx_type2: t[2], tx_type3: t[3],
    version,
  };
  // Optional hash columns (require ALTER TABLE ... ADD COLUMN block_hash/parent_hash).
  // Storing them lets a future pass detect reorgs by walking the parent-hash chain.
  if (WITH_HASHES) {
    row.block_hash = b.hash || '';
    row.parent_hash = b.parentHash || '';
  }
  return row;
}

async function chMaxBlock() {
  const res = await fetch(`${CH}/?query=${encodeURIComponent('SELECT max(block_number) FROM glamsterdam.block_stats')}`, {
    headers: { Authorization: auth },
  });
  const t = (await res.text()).trim();
  return t && t !== '\\N' ? Number(t) : -1;
}

async function main() {
  const head = hexN(await rpc('eth_blockNumber', []));
  // Reorg-safe ceiling: never index past the finalized head (finalized blocks
  // cannot reorg). ALLOW_UNFINALIZED=1 opts back into indexing to the live head.
  let finalized = head;
  if (!ALLOW_UNFINALIZED) {
    const fb = await rpc('eth_getBlockByNumber', ['finalized', false]);
    finalized = fb && fb.number != null ? hexN(fb.number) : head;
  }
  const ceiling = ALLOW_UNFINALIZED ? head : Math.min(head, finalized);

  // Auto-resume from last indexed block unless START is given explicitly.
  const start = process.env.START != null ? Number(process.env.START) : (await chMaxBlock()) + 1;
  const requestedEnd = process.env.END && process.env.END !== 'head' ? Number(process.env.END) : head;
  const end = Math.min(requestedEnd, ceiling);
  console.log(
    `Devnet head=${head}, finalized=${finalized}. Collecting blocks ${start}..${end} ` +
    `(${ALLOW_UNFINALIZED ? 'UNFINALIZED — near-head blocks may reorg' : 'finalized-only, reorg-safe'}, ` +
    `batch ${BATCH}, delay ${DELAY_MS}ms).`,
  );
  if (start > end) {
    console.log(`Nothing to do: start ${start} > end ${end} (already caught up to the finalized head).`);
    return;
  }

  let done = 0;
  let prevHash = null; // running parent-chain check across batches
  for (let from = start; from <= end; from += BATCH) {
    const to = Math.min(from + BATCH - 1, end);
    try {
      const blocks = await Promise.all(
        Array.from({ length: to - from + 1 }, (_, i) =>
          rpc('eth_getBlockByNumber', ['0x' + (from + i).toString(16), true]),
        ),
      );
      const ordered = blocks.filter(Boolean).sort((a, b) => hexN(a.number) - hexN(b.number));
      // A parent_hash that doesn't chain to the previous block signals a reorg
      // boundary in the range we're indexing (should never happen finalized-only).
      for (const b of ordered) {
        if (prevHash && b.parentHash && b.parentHash !== prevHash) {
          console.warn(`  ⚠ chain break at block ${hexN(b.number)}: parent ${b.parentHash.slice(0, 12)} != prev ${prevHash.slice(0, 12)} (possible reorg)`);
        }
        prevHash = b.hash || prevHash;
      }
      await chInsert(ordered.map(blockToRow));
      done += ordered.length;
    } catch (e) {
      console.error(`  batch ${from}..${to} failed after retries: ${e.message} — continuing`);
      prevHash = null; // gap: don't false-alarm on the next batch
    }
    if (to % (BATCH * 20) < BATCH) console.log(`  ${to}/${end} (${((100 * (to - start)) / (end - start + 1)).toFixed(1)}%)`);
    if (DELAY_MS) await sleep(DELAY_MS);
  }
  console.log(`Done. Processed to ${end}; inserted ~${done} blocks into glamsterdam.block_stats.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
