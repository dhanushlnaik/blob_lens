#!/usr/bin/env node
/**
 * Backfill / update blob_lens.eth_daily_price (daily ETH/USD close).
 *
 * The table was seeded once from Kraken and has no live updater, so it freezes
 * at whatever day the seed ran. This script fetches Kraken daily closes and
 * upserts every day from the last stored date to today. The table is a
 * ReplacingMergeTree on `date`, so re-inserting a day is a safe no-op.
 *
 * Run (where there is egress + ClickHouse access, e.g. the ba-data box):
 *   CLICKHOUSE_URL=http://ba-data:8123 CLICKHOUSE_USER=... CLICKHOUSE_PASSWORD=... \
 *     node scripts/backfill-eth-price.mjs
 *
 * Schedule it daily (cron or pm2) to keep the table current.
 */

const CH_URL = process.env.CLICKHOUSE_URL;
const CH_USER = process.env.CLICKHOUSE_USER ?? 'default';
const CH_PW = process.env.CLICKHOUSE_PASSWORD ?? '';

if (!CH_URL) {
  console.error('Set CLICKHOUSE_URL (and CLICKHOUSE_USER / CLICKHOUSE_PASSWORD).');
  process.exit(1);
}

function chUrl() {
  const u = new URL(CH_URL);
  u.searchParams.set('user', CH_USER);
  u.searchParams.set('password', CH_PW);
  return u.toString();
}

async function chQuery(sql) {
  const res = await fetch(chUrl(), { method: 'POST', body: sql, headers: { 'Content-Type': 'text/plain' } });
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.text()).trim();
}

async function main() {
  // 1) Where does the table currently end?
  const maxDate = await chQuery(
    "SELECT toString(max(date)) FROM blob_lens.eth_daily_price FORMAT TabSeparated",
  );
  console.log(`eth_daily_price currently ends at: ${maxDate || '(empty)'}`);

  // 2) Fetch Kraken daily OHLC for ETH/USD (returns ~720 most recent days).
  const kr = await fetch('https://api.kraken.com/0/public/OHLC?pair=ETHUSD&interval=1440').then((r) => r.json());
  if (kr.error && kr.error.length) throw new Error(`Kraken: ${kr.error.join(', ')}`);
  const key = Object.keys(kr.result).find((k) => k !== 'last');
  const candles = kr.result[key]; // [time, open, high, low, close, vwap, volume, count]

  // 3) Keep only days after the last stored date (and never today-incomplete? we
  //    include today; ReplacingMergeTree lets tomorrow's run overwrite it).
  const after = maxDate ? maxDate : '0000-00-00';
  const rows = [];
  for (const c of candles) {
    const day = new Date(c[0] * 1000).toISOString().slice(0, 10);
    const close = Number(c[4]);
    if (day > after && Number.isFinite(close) && close > 0) {
      rows.push(`('${day}', ${close})`);
    }
  }

  if (rows.length === 0) {
    console.log('Already up to date. Nothing to insert.');
    return;
  }

  await chQuery(`INSERT INTO blob_lens.eth_daily_price (date, price_usd) VALUES ${rows.join(',')}`);
  console.log(`Inserted ${rows.length} day(s): ${rows[0]} … ${rows[rows.length - 1]}`);

  const newMax = await chQuery("SELECT toString(max(date)) FROM blob_lens.eth_daily_price FORMAT TabSeparated");
  console.log(`eth_daily_price now ends at: ${newMax}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
