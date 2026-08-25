import { Suspense } from "react";
import { PlatabergetClient } from "./plataberget-client";

export const metadata = {
  title: "Platåberget Impact | BlobLens",
  description:
    "Measured impact of Ethereum's next upgrade on the live Platåberget testnet: 200M gas-limit throughput, scaling, and what it projects for mainnet.",
};

export default function PlatabergetPage() {
  return (
    <main className="px-4 sm:px-6 pb-16">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-48 font-mono text-xs text-[var(--text-muted)] animate-pulse tracking-widest">
            [ LOADING TESTNET IMPACT... ]
          </div>
        }
      >
        <PlatabergetClient />
      </Suspense>
    </main>
  );
}
