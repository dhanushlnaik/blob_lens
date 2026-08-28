import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

// Ground-truth validation: diff our indexed glamsterdam.block_stats against
// ethpandaops' Dora explorer for the same Platåberget devnet. Dora is beacon/slot
// indexed; each slot carries eth_block_number (our join key) plus blob_count,
// eth_transaction_count, gas_used and gas_limit — the exact metrics we index.
// We compare the most-recent window of blocks that BOTH systems have (our indexer
// lags Dora's head), matching on block number, and report per-block + aggregate
// parity so we can prove our analytics are correct.

const DORA = "https://dora.glamsterdam-devnet-8.ethpandaops.io/api/v1";
const DEFAULT_WINDOW = 300; // recent overlapping blocks to diff
const MAX_WINDOW = 2000;

type DoraSlot = {
  slot: number;
  status: string;
  with_eth_block: boolean;
  eth_block_number: number;
  blob_count: number;
  eth_transaction_count: number;
  gas_used: number;
  gas_limit: number;
};

async function doraGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${DORA}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data ?? null) as T;
  } catch {
    return null;
  }
}

// Page through Dora slots in [minSlot, maxSlot], skipping missing/orphaned slots.
async function fetchDoraWindow(minSlot: number, maxSlot: number): Promise<DoraSlot[]> {
  const out: DoraSlot[] = [];
  for (let page = 0; page < 40; page++) {
    const data = await doraGet<{ slots: DoraSlot[] }>(
      `/slots?min_slot=${minSlot}&max_slot=${maxSlot}&limit=100&page=${page}&with_missing=0&with_orphaned=0`,
    );
    const slots = data?.slots ?? [];
    out.push(...slots);
    if (slots.length < 100) break;
  }
  return out;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const window = Math.min(
      MAX_WINDOW,
      Math.max(20, Number(url.searchParams.get("window")) || DEFAULT_WINDOW),
    );

    // ── Our side: deduped (ReplacingMergeTree → FINAL) ──────────────────────
    const [maxRow] = await queryClickHouse<{ max_block: number }>(
      `SELECT max(block_number) AS max_block FROM glamsterdam.block_stats`,
    );
    const ourMaxBlock = Number(maxRow?.max_block ?? 0);
    const lo = ourMaxBlock - window + 1;

    const [healthRow] = await queryClickHouse<{ total: number; distinct: number }>(
      `SELECT count() AS total, uniqExact(block_number) AS distinct FROM glamsterdam.block_stats`,
    );
    const totalRows = Number(healthRow?.total ?? 0);
    const distinctBlocks = Number(healthRow?.distinct ?? 0);

    const ourRows = await queryClickHouse<{
      block_number: number;
      blob_count: number;
      tx_count: number;
      gas_used: number;
      gas_limit: number;
      ts: number;
    }>(`
      SELECT block_number, blob_count, tx_count, gas_used, gas_limit,
             toUnixTimestamp(block_timestamp) AS ts
      FROM glamsterdam.block_stats FINAL
      WHERE block_number BETWEEN ${lo} AND ${ourMaxBlock}
      ORDER BY block_number
    `);

    // ── Dora side: head (for lag) + the slot window covering our blocks ─────
    // The very latest slot may be scheduled with no execution block yet, so scan
    // recent slots for a concrete (slot, eth_block_number) anchor pair.
    const headData = await doraGet<{ slots: DoraSlot[] }>(
      `/slots?limit=30&with_missing=0&with_orphaned=0`,
    );
    const anchor = (headData?.slots ?? []).find((s) => s.with_eth_block && s.eth_block_number > 0);
    const doraHeadSlot = anchor?.slot ?? 0;
    const doraHeadBlock = anchor?.eth_block_number ?? 0;

    // slot = block + (accumulated missed slots). Missed slots only accumulate over
    // time, so the offset grows ~linearly from 0 at genesis to (headSlot-headBlock)
    // at the anchor. Estimate the local offset to fetch a tight slot window, match
    // precisely on block number, then expand the window if coverage falls short.
    const maxOffset = Math.max(0, doraHeadSlot - doraHeadBlock);
    const offAt = (block: number) =>
      doraHeadBlock > 0 ? (maxOffset * block) / doraHeadBlock : 0;

    // A devnet reorg can leave Dora with TWO slots that both claim the same
    // eth_block_number (both still labeled Canonical — Dora doesn't demote the
    // orphaned one). The surviving block is the LATER proposal, so key by
    // eth_block_number keeping the highest slot; otherwise we'd diff against an
    // orphaned block and report a false mismatch.
    const doraByBlock = new Map<number, DoraSlot>();
    const ingest = (slots: DoraSlot[]) => {
      for (const s of slots) {
        if (!s.with_eth_block) continue;
        const existing = doraByBlock.get(s.eth_block_number);
        if (!existing || s.slot > existing.slot) doraByBlock.set(s.eth_block_number, s);
      }
    };

    let slack = 80;
    for (let attempt = 0; attempt < 3; attempt++) {
      const minSlot = Math.max(0, Math.floor(lo + offAt(lo)) - slack);
      const maxSlot = Math.ceil(ourMaxBlock + offAt(ourMaxBlock)) + slack;
      ingest(await fetchDoraWindow(minSlot, maxSlot));
      // Covered if both ends of our block range resolved.
      if (doraByBlock.has(lo) && doraByBlock.has(ourMaxBlock)) break;
      slack *= 4; // widen and retry
    }

    // ── Diff ────────────────────────────────────────────────────────────────
    type Row = {
      block: number;
      ts: number;
      ours: { blob: number; tx: number; gasUsed: number; gasLimit: number } | null;
      dora: { blob: number; tx: number; gasUsed: number; gasLimit: number } | null;
      match: { blob: boolean; tx: boolean; gasUsed: boolean; gasLimit: boolean } | null;
      allMatch: boolean;
      note?: string;
    };

    const rows: Row[] = ourRows.map((r) => {
      const block = Number(r.block_number);
      const ours = {
        blob: Number(r.blob_count),
        tx: Number(r.tx_count),
        gasUsed: Number(r.gas_used),
        gasLimit: Number(r.gas_limit),
      };
      const d = doraByBlock.get(block);
      if (!d) {
        return { block, ts: Number(r.ts), ours, dora: null, match: null, allMatch: false, note: "not in Dora window" };
      }
      const dora = {
        blob: Number(d.blob_count),
        tx: Number(d.eth_transaction_count),
        gasUsed: Number(d.gas_used),
        gasLimit: Number(d.gas_limit),
      };
      const match = {
        blob: ours.blob === dora.blob,
        tx: ours.tx === dora.tx,
        gasUsed: ours.gasUsed === dora.gasUsed,
        gasLimit: ours.gasLimit === dora.gasLimit,
      };
      const allMatch = match.blob && match.tx && match.gasUsed && match.gasLimit;
      return { block, ts: Number(r.ts), ours, dora, match, allMatch };
    });

    const compared = rows.filter((r) => r.dora);
    const sum = (f: (r: Row) => number, side: "ours" | "dora") =>
      compared.reduce((a, r) => a + (r[side] ? f(r) : 0), 0);

    const totals = {
      compared_blocks: compared.length,
      window_requested: window,
      matched_blocks: rows.filter((r) => r.allMatch).length,
      mismatched_blocks: compared.filter((r) => !r.allMatch).length,
      uncovered_blocks: rows.filter((r) => !r.dora).length,
      per_metric_mismatch: {
        blob: compared.filter((r) => r.match && !r.match.blob).length,
        tx: compared.filter((r) => r.match && !r.match.tx).length,
        gasUsed: compared.filter((r) => r.match && !r.match.gasUsed).length,
        gasLimit: compared.filter((r) => r.match && !r.match.gasLimit).length,
      },
      blobs: { ours: sum((r) => r.ours!.blob, "ours"), dora: sum((r) => r.dora!.blob, "dora") },
      txs: { ours: sum((r) => r.ours!.tx, "ours"), dora: sum((r) => r.dora!.tx, "dora") },
      gas_used: { ours: sum((r) => r.ours!.gasUsed, "ours"), dora: sum((r) => r.dora!.gasUsed, "dora") },
    };

    return NextResponse.json({
      network: { name: "Platåberget (glamsterdam-devnet-8)", dora: DORA.replace("/api/v1", "") },
      health: {
        our_max_block: ourMaxBlock,
        dora_head_block: doraHeadBlock,
        indexer_lag_blocks: Math.max(0, doraHeadBlock - ourMaxBlock),
        total_rows: totalRows,
        distinct_blocks: distinctBlocks,
        duplicate_rows: Math.max(0, totalRows - distinctBlocks),
      },
      window: { lo, hi: ourMaxBlock },
      totals,
      rows: rows.slice().reverse(), // newest first for the table
    });
  } catch (e) {
    return NextResponse.json(
      { error: `validation query failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
