import { Metadata } from "next";
import { DexClient } from "./dex-client";

export const metadata: Metadata = {
  title: "Ethereum DEX MEV Analytics | BlobLens Observatory",
  description:
    "Ethereum DEX sandwich-attack analytics: which DEXes are most affected, which bots extract the most value (ETH & USD), DEX volume ratios, victim trends, and token exposure.",
};

export default function DexPage() {
  return <DexClient />;
}
