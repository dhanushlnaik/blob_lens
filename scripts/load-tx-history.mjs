#!/usr/bin/env node
/**
 * One-time loader for pre-Dencun transaction history, so the EIPsInsight
 * account-abstraction charts reach back toward Ethereum genesis (2015), not just
 * Dencun (2024-03) where our own indexed data begins.
 *
 * Design: the history is loaded DAILY into the SAME table as the live rollup
 * (blob_lens.tx_daily_type_stats), mirroring its schema exactly. That way every
 * rollup-backed chart (type share, migration, economics, composition, blob) picks
 * up the full history automatically, with no separate table or splice logic. The
 * live daily rollup owns 2024-03-13 onward and never touches earlier dates, so the
 * two never collide (and ReplacingMergeTree dedups on (date, tx_type, class) if a
 * date is ever loaded twice).
 *
 * Source: the BigQuery public Ethereum dataset. Run this in the BigQuery console
 * (Sandbox is fine — it caps at the 1 TB/month free quota and cannot be charged),
 * then download the result as CSV:
 *
 *   SELECT
 *     DATE(block_timestamp) AS date,
 *     COALESCE(transaction_type, 0) AS tx_type,
 *     CASE
 *       WHEN COALESCE(transaction_type, 0) = 3 THEN 'blob'
 *       WHEN COALESCE(transaction_type, 0) = 4 THEN 'setcode'
 *       WHEN input IS NULL OR LENGTH(input) <= 2 THEN 'transfer'
 *       ELSE 'contract'
 *     END AS class,
 *     COUNT(*) AS tx_count,
 *     SUM(receipt_gas_used) AS gas_used,
 *     SUM(CAST(receipt_gas_used AS FLOAT64) * CAST(gas_price AS FLOAT64)) / 1e18 AS fees_eth,
 *     COUNTIF(receipt_status = 1) AS success,
 *     COUNTIF(receipt_status = 0) AS failed,
 *     0 AS num_blobs
 *   FROM `bigquery-public-data.crypto_ethereum.transactions`
 *   WHERE block_timestamp < TIMESTAMP('2024-03-13')
 *   GROUP BY date, tx_type, class
 *   ORDER BY date, tx_type, class
 *
 * Then load it:
 *
 *   CLICKHOUSE_URL=http://100.76.225.2:8123 CLICKHOUSE_USER=blob_lens \
 *     CLICKHOUSE_PASSWORD=changeme \
 *     node scripts/load-tx-history.mjs ./tx-history-daily.csv
 *
 * The header row is auto-detected. Expected columns, in any order:
 *   date (YYYY-MM-DD), tx_type, class, tx_count, gas_used, fees_eth, success, failed, num_blobs
 */

import { readFileSync } from 'node:fs';

const CH_URL = process.env.CLICKHOUSE_URL;
const CH_USER = process.env.CLICKHOUSE_USER ?? 'default';
const CH_PW = process.env.CLICKHOUSE_PASSWORD ?? '';
const FILE = process.argv[2];

if (!CH_URL) {
  console.error('Set CLICKHOUSE_URL (and CLICKHOUSE_USER / CLICKHOUSE_PASSWORD).');
  process.exit(1);
}
if (!FILE) {
  console.error('Usage: node scripts/load-tx-history.mjs <bigquery-export.csv>');
  process.exit(1);
}

// The live rollup owns this date and everything after it; history must stay before.
const CUTOFF = '2024-03-13';
const VALID_CLASS = new Set(['transfer', 'contract', 'blob', 'setcode', 'legacy']);
const CHUNK = 5000;

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

async function ensureTable() {
  // Identical to rollup-tx-daily.mjs; a no-op if the table already exists.
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

// Minimal CSV parse: values are numbers, a YYYY-MM-DD date, or a short class word.
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const col = (name) => header.indexOf(name);
  const iDate = col('date');
  const iType = col('tx_type');
  const iClass = col('class');
  const iCount = col('tx_count');
  const iGas = col('gas_used');
  const iFees = col('fees_eth');
  const iSucc = col('success');
  const iFail = col('failed');
  const iBlobs = col('num_blobs');
  if (iDate < 0 || iType < 0 || iClass < 0 || iCount < 0) {
    throw new Error(`CSV must have date, tx_type, class, tx_count columns. Got: ${header.join(', ')}`);
  }
  const num = (v) => {
    const n = Number((v ?? '').toString().replace(/^"|"$/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const date = (c[iDate] ?? '').trim().replace(/^"|"$/g, ''); // "2015-08-07"
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let cls = (c[iClass] ?? '').trim().toLowerCase().replace(/^"|"$/g, '');
    if (!VALID_CLASS.has(cls)) cls = 'legacy';
    out.push({
      date,
      tx_type: Math.trunc(num(c[iType])),
      class: cls,
      tx_count: Math.trunc(num(c[iCount])),
      gas_used: iGas >= 0 ? Math.trunc(num(c[iGas])) : 0,
      fees_eth: iFees >= 0 ? num(c[iFees]) : 0,
      success: iSucc >= 0 ? Math.trunc(num(c[iSucc])) : 0,
      failed: iFail >= 0 ? Math.trunc(num(c[iFail])) : 0,
      num_blobs: iBlobs >= 0 ? Math.trunc(num(c[iBlobs])) : 0,
    });
  }
  return out;
}

async function main() {
  const parsed = parseCsv(readFileSync(FILE, 'utf8'));
  const kept = parsed.filter((r) => r.date < CUTOFF);
  const dropped = parsed.length - kept.length;
  if (!kept.length) {
    console.error('No pre-Dencun rows parsed from the CSV. Check the file and header.');
    process.exit(1);
  }
  if (dropped > 0) console.log(`Skipping ${dropped} row(s) at/after ${CUTOFF} (owned by the live rollup).`);

  await ensureTable();

  const esc = (s) => s.replace(/'/g, "\\'");
  for (let i = 0; i < kept.length; i += CHUNK) {
    const slice = kept.slice(i, i + CHUNK);
    const values = slice
      .map(
        (r) =>
          `('${r.date}', ${r.tx_type}, '${esc(r.class)}', ${r.tx_count}, ${r.gas_used}, ${r.fees_eth}, ${r.success}, ${r.failed}, ${r.num_blobs})`,
      )
      .join(',');
    await chQuery(
      `INSERT INTO blob_lens.tx_daily_type_stats (date, tx_type, class, tx_count, gas_used, fees_eth, success, failed, num_blobs) VALUES ${values}`,
    );
    console.log(`  inserted ${Math.min(i + CHUNK, kept.length)}/${kept.length}`);
  }

  const range = await chQuery(
    'SELECT toString(min(date)), toString(max(date)), count() FROM blob_lens.tx_daily_type_stats FINAL FORMAT TabSeparated',
  );
  console.log(`Loaded ${kept.length} history row(s). tx_daily_type_stats now spans: ${range}`);
  console.log('Dedups via ReplacingMergeTree; the app reads it with FINAL. Re-running overwrites cleanly.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
