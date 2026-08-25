import { NextResponse } from "next/server";
import { queryClickHouse } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

// Glamsterdam devnet impact: measured devnet-8 aggregates vs mainnet baseline.
// Devnet data = isolated glamsterdam.block_stats (never mainnet tables).
// Honesty: devnet traffic is synthetic/low, so blocks are not full, the story is
// CAPACITY (200M gas limit vs mainnet ~45M), not observed throughput. The page labels this.

const RECENT_DEVNET_BLOCKS = 2000;   // most-recent indexed devnet window (highest gas limit)
const RECENT_MAINNET_BLOCKS = 50000; // ~1 week of mainnet

type Row = Record<string, number>;

export async function GET() {
  try {
    const [progressRows, devnetRows, mainGasRows, mainTxRows, mainBlobRows, seriesRows] = await Promise.all([
      queryClickHouse<Row>(`
        SELECT count() AS blocks_indexed,
               min(block_number) AS first_block,
               max(block_number) AS last_block,
               toUnixTimestamp(max(block_timestamp)) AS last_ts
        FROM glamsterdam.block_stats
      `),
      queryClickHouse<Row>(`
        SELECT round(avg(gas_limit)) AS gas_limit,
               round(avg(gas_used)) AS gas_used,
               round(avg(gas_util), 4) AS gas_util,
               round(avg(tx_count), 1) AS tx_per_block,
               round(avg(tx_type0), 1) AS tx_type0,
               round(avg(tx_type1), 1) AS tx_type1,
               round(avg(tx_type2), 1) AS tx_type2,
               round(avg(tx_type3), 1) AS tx_type3,
               round(avg(blob_count), 2) AS blobs_per_block,
               round(avg(base_fee_per_gas)) AS base_fee_wei
        FROM glamsterdam.block_stats
        WHERE block_number > (SELECT max(block_number) - ${RECENT_DEVNET_BLOCKS} FROM glamsterdam.block_stats)
      `),
      queryClickHouse<Row>(`
        SELECT round(avg(gas_limit)) AS avg_gas_limit,
               round(avg(gas_used)) AS avg_gas_used,
               round(avg(gas_used / gas_limit), 4) AS gas_util,
               round(avg(base_fee_per_gas)) AS base_fee_wei
        FROM ethereum.blocks
        WHERE number > (SELECT max(number) - ${RECENT_MAINNET_BLOCKS} FROM ethereum.blocks)
      `),
      queryClickHouse<Row>(`
        SELECT round(avg(tx_count), 1) AS tx_per_block
        FROM ethereum.block_gas_stats
        WHERE block_number > (SELECT max(block_number) - ${RECENT_MAINNET_BLOCKS} FROM ethereum.block_gas_stats)
      `),
      queryClickHouse<Row>(`
        SELECT round(avg(blob_count), 2) AS blobs_per_block
        FROM blob_lens.block_blob_stats
        WHERE block_number > (SELECT max(block_number) - ${RECENT_MAINNET_BLOCKS} FROM blob_lens.block_blob_stats)
      `),
      // Full-life ramp: gas + tx + blobs across the whole testnet, bucketed by
      // 1000 blocks. Shows capacity scaling from 60M to ~200M over the network's life.
      queryClickHouse<Row>(`
        SELECT intDiv(block_number, 1000) * 1000 AS bucket,
               round(avg(gas_limit)) AS gas_limit,
               round(avg(gas_used)) AS gas_used,
               round(avg(tx_count), 1) AS tx_count,
               round(avg(blob_count), 2) AS blob_count
        FROM glamsterdam.block_stats
        GROUP BY bucket
        ORDER BY bucket
      `),
    ]);

    const progress = progressRows[0] ?? {};
    const devnet = devnetRows[0] ?? {};
    const mainGas = mainGasRows[0] ?? {};
    const mainTx = mainTxRows[0] ?? {};

    const devnetGasLimit = devnet.gas_limit ?? 0;
    const mainnetGasLimit = mainGas.avg_gas_limit ?? 0;
    const mainnetTxPerBlock = mainTx.tx_per_block ?? 0;

    // Capacity ratio and a simple throughput projection: if mainnet ran the devnet
    // gas limit at the same average tx gas cost, blocks could hold this many txs.
    const capacityRatio = mainnetGasLimit > 0 ? devnetGasLimit / mainnetGasLimit : null;
    const projectedMainnetTxPerBlock =
      capacityRatio != null ? Math.round(mainnetTxPerBlock * capacityRatio) : null;

    return NextResponse.json({
      network: {
        name: "Platåberget testnet",
        rpc: "rpc.plataberget.ethpandaops.io",
        blocks_indexed: progress.blocks_indexed ?? 0,
        first_block: progress.first_block ?? null,
        last_block: progress.last_block ?? null,
        last_indexed_ts: progress.last_ts ?? null,
      },
      devnet: {
        gas_limit: devnetGasLimit,
        gas_used: devnet.gas_used ?? 0,
        gas_util: devnet.gas_util ?? 0,
        tx_per_block: devnet.tx_per_block ?? 0,
        tx_types: {
          legacy: devnet.tx_type0 ?? 0,
          access_list: devnet.tx_type1 ?? 0,
          eip1559: devnet.tx_type2 ?? 0,
          blob: devnet.tx_type3 ?? 0,
        },
        blobs_per_block: devnet.blobs_per_block ?? 0,
        base_fee_gwei: (devnet.base_fee_wei ?? 0) / 1e9,
      },
      mainnet: {
        gas_limit: mainnetGasLimit,
        gas_used: mainGas.avg_gas_used ?? 0,
        gas_util: mainGas.gas_util ?? 0,
        tx_per_block: mainnetTxPerBlock,
        blobs_per_block: mainBlobRows[0]?.blobs_per_block ?? 0,
        base_fee_gwei: (mainGas.base_fee_wei ?? 0) / 1e9,
      },
      projection: {
        capacity_ratio: capacityRatio,
        projected_mainnet_tx_per_block: projectedMainnetTxPerBlock,
        note: "Testnet blocks are not full (light traffic); this reflects CAPACITY at the higher gas limit, not observed demand.",
      },
      ramp: seriesRows.map((r) => ({
        block: r.bucket,
        gas_limit: r.gas_limit,
        gas_used: r.gas_used,
        tx_count: r.tx_count,
        blob_count: r.blob_count,
      })),
      eips: [
        { id: "200M gas limit", label: "Block gas limit raised to ~200M (testnet target)" },
        { id: "EIP-7778", label: "Block gas accounting without refunds" },
        { id: "EIP-8037", label: "State-creation gas cost increase" },
        { id: "EIP-2780", label: "Resource-based intrinsic transaction gas" },
        { id: "EIP-7708", label: "ETH transfers emit a log" },
      ],
      disclaimer:
        "Testnet projection, not a mainnet measurement. The Plataberget testnet runs the next Ethereum upgrade's rules with light traffic.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: `plataberget impact query failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
