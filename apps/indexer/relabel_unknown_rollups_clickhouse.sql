-- Relabel historical UNKNOWN rows in ClickHouse using the rollup identities
-- recovered 2026-08 (via Blobscan). The Rust registry only labels NEW blobs after
-- a rebuild; this mutation fixes existing rows that the web app already reads.
--
-- Run (single mutation, matches the resolver's from-then-to logic):
--   curl --user "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
--     --data-binary @relabel_unknown_rollups_clickhouse.sql "$CLICKHOUSE_URL"
-- Then watch it finish (mutations are async):
--   SELECT * FROM system.mutations WHERE table='blob_transactions' AND is_done=0;

ALTER TABLE blob_lens.blob_transactions
UPDATE rollup = multiIf(
  lower(to_address) = '0x06a9ab27c7e2255df1815e6cc0168d7755feb19a'
    OR lower(from_address) = '0x7a853a6480f4d7db79ae91c16c960dbbb6710d25', 'Taiko',
  lower(to_address) = '0x3b4d794a66304f130a4db8f2551b0070dfcf5ca7',        'Lighter',
  lower(from_address) = '0xcf2898225ed05be911d3709d9417e86e0b4cfc8f',      'Scroll',
  lower(from_address) = '0xa9268341831efa4937537bc3e9eb36dbece83c7e',      'Linea',
  lower(from_address) = '0x0d3250c3d5facb74ac15834096397a3ef790ec99',      'zkSync Era',
  lower(from_address) = '0x99199a22125034c808ff20f377d91187e8050f2e',      'Mode',
  lower(from_address) = '0x41b8cd6791de4d8f9e0eaf7861ac506822adce12',      'Kroma',
  lower(from_address) = '0x52ee324f2bcd0c5363d713eb9f62d1ee47266ac1',      'River',
  lower(from_address) = '0x11805594be0229ef08429d775af0c55f7c4535de',      'Abstract',
  lower(from_address) = '0xa6ea2f3299b63c53143c993d2d5e60a69cd6fe24',      'Lisk',
  lower(from_address) = '0x68bdfece01535090c8f3c27ec3b1ae97e83fa4aa',      'Mint',
  lower(from_address) = '0x8cda8351236199af7532bad53d683ddd9b275d89',      'Race',
  lower(from_address) = '0xc94c243f8fb37223f3eb2f7961f7072602a51b8b',      'Metal L2',
  lower(from_address) = '0xea0337efc12e98ab118948da570c07691e8e4b37',      'Fuel',
  lower(from_address) = '0x67a44ce38627f46f20b1293960559ed85dd194f1',      'Polynomial',
  lower(from_address) = '0xe1b64045351b0b6e9821f19b39f81bc4711d2230',      'Boba Network',
  lower(from_address) = '0x3d0bf26e60a689a7da5ea3ddad7371f27f7671a5',      'Optopia',
  lower(from_address) IN ('0xbba36cdf020788f0d08d5688c0bee3fb30ce1c80',
                          '0x34e387b37d3adeaa6d5b92ce30de3af3dca39796'),   'Morph',
  rollup)
WHERE rollup = 'UNKNOWN'
  AND (
    lower(to_address)   IN ('0x06a9ab27c7e2255df1815e6cc0168d7755feb19a',
                            '0x3b4d794a66304f130a4db8f2551b0070dfcf5ca7')
    OR lower(from_address) IN (
      '0x7a853a6480f4d7db79ae91c16c960dbbb6710d25',
      '0xcf2898225ed05be911d3709d9417e86e0b4cfc8f',
      '0xa9268341831efa4937537bc3e9eb36dbece83c7e',
      '0x0d3250c3d5facb74ac15834096397a3ef790ec99',
      '0x99199a22125034c808ff20f377d91187e8050f2e',
      '0x41b8cd6791de4d8f9e0eaf7861ac506822adce12',
      '0x52ee324f2bcd0c5363d713eb9f62d1ee47266ac1',
      '0x11805594be0229ef08429d775af0c55f7c4535de',
      '0xa6ea2f3299b63c53143c993d2d5e60a69cd6fe24',
      '0x68bdfece01535090c8f3c27ec3b1ae97e83fa4aa',
      '0x8cda8351236199af7532bad53d683ddd9b275d89',
      '0xc94c243f8fb37223f3eb2f7961f7072602a51b8b',
      '0xea0337efc12e98ab118948da570c07691e8e4b37',
      '0x67a44ce38627f46f20b1293960559ed85dd194f1',
      '0xe1b64045351b0b6e9821f19b39f81bc4711d2230',
      '0x3d0bf26e60a689a7da5ea3ddad7371f27f7671a5',
      '0xbba36cdf020788f0d08d5688c0bee3fb30ce1c80',
      '0x34e387b37d3adeaa6d5b92ce30de3af3dca39796'
    )
  );
