const path = require("path");

// __dirname = /opt/blob-lens/releases/<RELEASE>/ops/pm2
// root      = /opt/blob-lens/releases/<RELEASE>
// sharedLogs= /opt/blob-lens/shared/logs  (two levels up from root, then into shared/logs)
const root = path.resolve(__dirname, "..", "..");
const sharedLogs = path.resolve(root, "..", "..", "shared", "logs");

module.exports = {
  apps: [
    {
      name: "blob-lens-web",
      cwd: path.join(root, "apps", "web"),
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "800M",
      env_production: {
        NODE_ENV: "production",
      },
      out_file: path.join(sharedLogs, "web.out.log"),
      error_file: path.join(sharedLogs, "web.err.log"),
      time: true,
    },
    {
      name: "blob-lens-indexer",
      cwd: path.join(root, "apps", "api_v1"),
      script: path.join(root, "apps", "api_v1", "target", "release", "blob_lens"),
      interpreter: "none",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      env_production: {
        RUST_LOG: "info",
      },
      out_file: path.join(sharedLogs, "indexer.out.log"),
      error_file: path.join(sharedLogs, "indexer.err.log"),
      time: true,
    },
    {
      // Glamsterdam devnet collector — pulls per-block stats into
      // glamsterdam.block_stats. Runs to completion (autorestart:false), then
      // cron_restart reruns it every 5 min; it auto-resumes from the last stored
      // block and only indexes up to the FINALIZED head (reorg-safe), so each run
      // just appends the newly-finalized blocks. Secrets come from the pm2
      // environment — export CLICKHOUSE_PASSWORD before `pm2 start ... --env production`.
      name: "blob-lens-devnet-collector",
      cwd: path.join(root, "apps", "indexer"),
      script: "devnet_collector.mjs",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: false,
      cron_restart: "*/5 * * * *",
      env_production: {
        RPC: process.env.DEVNET_RPC || "https://rpc.plataberget.ethpandaops.io/",
        CH: process.env.CLICKHOUSE_HTTP || "http://ba-data:8123",
        CH_USER: process.env.CLICKHOUSE_USER || "blob_lens",
        CH_PASS: process.env.CLICKHOUSE_PASSWORD || "",
        BATCH: "50",
        DELAY_MS: "150",
        WITH_HASHES: "1",
      },
      out_file: path.join(sharedLogs, "devnet-collector.out.log"),
      error_file: path.join(sharedLogs, "devnet-collector.err.log"),
      time: true,
    },
  ],
};
