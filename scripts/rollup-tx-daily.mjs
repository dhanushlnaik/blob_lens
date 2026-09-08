#!/usr/bin/env node
/**
 * Daily rollup of Ethereum L1 transactions by type and class, for the
 * EIPsInsight account-abstraction ecosystem dashboard.
 *
 * Source tables (ClickHouse, populated by the exex-node / indexer):
 *   ethereum.transactions  (tx_type, input, num_blobs, ...)
 *   ethereum.receipts      (success, gas_used, effective_gas_price, ...)
 *
 * A live per-month query over these is too slow (scanning the `input` column and
 * joining receipts across a year takes 30s+). Instead we pre-aggregate to a
 * small daily table. The join is done ONE DAY AT A TIME (~1s each), so both the
 * one-time backfill and the daily incremental stay cheap and never time out.
 *
 * Destination (idempotent; re-running a day overwrites it):
 *   blob_lens.tx_daily_type_stats
 *     date, tx_type, class, tx_count, gas_used, fees_eth, success, failed, num_blobs
 *   where class = blob | setcode | contract | transfer
 *
 * Run (where there is ClickHouse access, e.g. the ba-data box):
 *   CLICKHOUSE_URL=http://ba-data:8123 CLICKHOUSE_USER=... CLICKHOUSE_PASSWORD=... \
 *     node scripts/rollup-tx-daily.mjs                 # incremental: last stored day -> today
 *   ... node scripts/rollup-tx-daily.mjs --from 2024-09-01   # full backfill from a date
 *
 * Schedule daily via pm2 cron_restart (see ops/pm2/ecosystem.config.cjs).
 */

const CH_URL = process.env.CLICKHOUSE_URL;
const CH_USER = process.env.CLICKHOUSE_USER ?? 'default';
const CH_PW = process.env.CLICKHOUSE_PASSWORD ?? '';

if (!CH_URL) {
  console.error('Set CLICKHOUSE_URL (and CLICKHOUSE_USER / CLICKHOUSE_PASSWORD).');
  process.exit(1);
}

// Oldest day we ever backfill to if the table is empty and no --from is given.
const DEFAULT_START = '2024-01-01';

function chUrl() {
  const u = new URL(CH_URL);
  u.searchParams.set('user', CH_USER);
  u.searchParams.set('password', CH_PW);
  return u.toString();
}

async function chQuery(sql) {
  const res = await fetch(chUrl(), { method: 'POST', body: sql, headers: { 'Content-Type': 'text/plain' } });
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return (await res.text()).trim();
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoStr, n) => {
  const d = new Date(`${isoStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

async function ensureTable() {
  await chQuery(`
    CREATE TABLE IF NOT EXISTS blob_lens.tx_daily_type_stats (
      date        Date,
      tx_type     UInt8,
      class       LowCardinality(String),
      tx_count    UInt64,
      gas_used    UInt64,
      fees_eth    Float64,
      success     UInt64,
      failed      UInt64,
      num_blobs   UInt64,
      inserted_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(inserted_at)
    PARTITION BY toYYYYMM(date)
    ORDER BY (date, tx_type, class)
    SETTINGS index_granularity = 8192
  `);
}

/** Aggregate a single UTC day [day, day+1) and upsert its rows. */
async function rollupDay(day) {
  const next = addDays(day, 1);
  await chQuery(`
    INSERT INTO blob_lens.tx_daily_type_stats
      (date, tx_type, class, tx_count, gas_used, fees_eth, success, failed, num_blobs)
    SELECT
      toDate('${day}')                                                                       AS date,
      t.tx_type                                                                              AS tx_type,
      multiIf(t.tx_type = 3, 'blob',
              t.tx_type = 4, 'setcode',
              length(t.input) > 2, 'contract',
              'transfer')                                                                    AS class,
      count()                                                                                AS tx_count,
      sum(r.gas_used)                                                                        AS gas_used,
      sum(toFloat64(r.gas_used) * toFloat64(r.effective_gas_price)) / 1e18                   AS fees_eth,
      countIf(r.success = 1)                                                                 AS success,
      countIf(r.success = 0)                                                                 AS failed,
      sum(t.num_blobs)                                                                       AS num_blobs
    FROM ethereum.transactions t
    INNER JOIN ethereum.receipts r ON t.tx_hash = r.tx_hash
    WHERE t.is_deleted = 0 AND r.is_deleted = 0
      AND t.block_timestamp >= toDateTime('${day} 00:00:00') AND t.block_timestamp < toDateTime('${next} 00:00:00')
      AND r.block_timestamp >= toDateTime('${day} 00:00:00') AND r.block_timestamp < toDateTime('${next} 00:00:00')
    GROUP BY t.tx_type, class
  `);
}

async function main() {
  const fromArg = (() => {
    const i = process.argv.indexOf('--from');
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  await ensureTable();

  const today = iso(new Date());
  let start;
  if (fromArg) {
    start = fromArg;
  } else {
    const maxDate = await chQuery('SELECT toString(max(date)) FROM blob_lens.tx_daily_type_stats FORMAT TabSeparated');
    // Re-do the last stored day (it may have been partial), else start from DEFAULT_START.
    start = maxDate && maxDate !== '1970-01-01' ? maxDate : DEFAULT_START;
  }

  console.log(`Rolling up ${start} .. ${today} (inclusive) into blob_lens.tx_daily_type_stats`);
  let day = start;
  let n = 0;
  const t0 = Date.now();
  while (day <= today) {
    await rollupDay(day);
    n++;
    if (n % 30 === 0) console.log(`  ...${day} (${n} days, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    day = addDays(day, 1);
  }
  console.log(`Done: ${n} day(s) in ${((Date.now() - t0) / 1000).toFixed(0)}s. Table dedups via ReplacingMergeTree; query with FINAL.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
