import type { NextConfig } from "next";
import "./src/env";

const nextConfig: NextConfig = {
  transpilePackages: ["@t3-oss/env-nextjs", "@t3-oss/env-core"],
  async redirects() {
    return [
      // DEX analytics lives at /dex now. Keep the old paths working:
      // /mev (was never a real route — 404'd) and /sandwiches both land on /dex.
      { source: "/mev", destination: "/dex", permanent: true },
      { source: "/sandwiches", destination: "/dex", permanent: true },
    ];
  },
};

export default nextConfig;
