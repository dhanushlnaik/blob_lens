import { Suspense } from "react";
import { ValidateClient } from "./validate-client";

export const metadata = {
  title: "Data Validation vs Dora | BlobLens",
  description:
    "Block-by-block validation of BlobLens analytics against ethpandaops' Dora explorer for the Platåberget (glamsterdam-devnet-8) network.",
};

export default function ValidatePage() {
  return (
    <main className="px-4 sm:px-6 pb-16">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-48 font-mono text-xs text-[var(--text-muted)] animate-pulse tracking-widest">
            [ VALIDATING AGAINST DORA... ]
          </div>
        }
      >
        <ValidateClient />
      </Suspense>
    </main>
  );
}
