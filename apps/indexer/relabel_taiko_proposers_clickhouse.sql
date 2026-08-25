-- Follow-up: the first relabel matched Taiko only by its TaikoL1 inbox, but its
-- proposers post to several inboxes, so ~1M blobs stayed UNKNOWN. Match by sender.
ALTER TABLE blob_lens.blob_transactions
UPDATE rollup = 'Taiko'
WHERE rollup = 'UNKNOWN'
  AND lower(from_address) IN (
    '0x000000633b68f5d8d3a86593ebb815b4663bcbe0',
    '0x41f2f55571f9e8e3ba511adc48879bd67626a2b6',
    '0x66cc9a0eb519e9e1de68f6cf0aa1aa1efe3723d5',
    '0x79fb4ebdd543d0927b809b1e8f552f1bf74dec65',
    '0x9a5cc6e3a3325cdc19fc76926cc9666c80139c09',
    '0x32f2713b062134e69f5006eb070bc41d9765f5c8'
  );
